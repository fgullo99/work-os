import type { SupabaseClient } from "@supabase/supabase-js";
import type { gmail_v1 } from "googleapis";
import { randomUUID } from "node:crypto";
import { getAuthorizedGmailClient } from "@/lib/google/oauthClient";
import { getGmailApi, getCurrentHistoryId, getThread, listThreadIdsSinceDays } from "./client";
import { parseThread } from "./threadParser";
import { processThread, type ApplySyncDeps, type ThreadSyncLogEntry } from "./applySync";
import { classifyThreadOutcome } from "./reconcile";
import { getAIProvider, type AiUsage } from "@/lib/ai";
import { todayInTimezone } from "@/lib/dates/timezone";
import { getUserAddresses } from "./sync";
import { updateSyncCursor } from "@/lib/google/connection";
import type { GoogleConnectionRow, GmailCatchupStateRow } from "@/lib/supabase/types";

type DB = SupabaseClient;

/** Threads por lote — junto con el time budget, evita reproducir el catch-up monolitico
 * que se colgo varios minutos sin checkpoint (ver incidente real del 2026-08-12). */
export const DEFAULT_CATCHUP_BATCH_SIZE = 25;
export const DEFAULT_CATCHUP_TIME_BUDGET_MS = 45_000;
export const DEFAULT_CATCHUP_WINDOW_DAYS = 7;
/** Un thread que falla se reintenta hasta esta cantidad de veces (en lotes sucesivos) antes
 * de pasar a permanently_failed_threads — nunca reintento infinito. */
export const MAX_RETRY_ATTEMPTS = 3;
/** Lock simple contra doble worker (dos pestañas, dos clicks). Si el worker que lo tomo
 * murio (timeout de Vercel, crash) el lock expira solo — nunca queda eterno. */
export const CATCHUP_LOCK_TTL_MS = 120_000;

export interface FailedThreadEntry {
  threadId: string;
  attempts: number;
  lastErrorClass: string;
  firstFailedAt: string;
  lastFailedAt: string;
}

/** Se lanza cuando ya hay otra ejecucion activa (lock reciente) para la misma conexion — el
 * caller (la API route) la traduce a 409 CATCHUP_ALREADY_RUNNING. */
export class CatchupLockError extends Error {
  constructor() {
    super("Ya hay un catch-up en curso para esta conexion (lock activo).");
    this.name = "CatchupLockError";
  }
}

/** Mismo desglose para el lote actual y para el acumulado del catch-up completo — nunca se
 * devuelven mezclados (ver pedido "no mezclar acumulados con delta del lote"). */
export interface CatchupCountsSnapshot {
  threadsProcessed: number;
  autoCreated: number;
  autoUpdated: number;
  /** TEAM_OTHER + DELEGATED_BY_FELIPE que se auto-aplico. */
  delegated: number;
  /** classification=WAITING entre los auto-aplicados (incluye EXTERNAL y BLOCKS_FELIPE). */
  waiting: number;
  noOp: number;
  ignored: number;
  review: number;
  failed: number;
  ruleFiltered: number;
}

/** Telemetria de costo — solo conteos, nunca contenido. Ver AiUsage en lib/ai/types.ts. */
export interface AiUsageSnapshot {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CatchupBatchResult {
  status: "in_progress" | "completed";
  thisBatch: CatchupCountsSnapshot & { durationMs: number; aiUsage: AiUsageSnapshot };
  total: CatchupCountsSnapshot & { pending: number; queueLength: number; aiUsage: AiUsageSnapshot };
  /** Threads efectivamente procesados o reintentados EN este lote — para el reporte
   * detallado (subject/relevance/attention_owner/team_other_relation/classification/
   * confidence/reason) que arma el caller. */
  entries: ThreadSyncLogEntry[];
  /** Cuantos threads quedan en la cola de reintento (todavia no agotaron MAX_RETRY_ATTEMPTS). */
  retryableFailedCount: number;
  /** Cuantos threads agotaron los reintentos y quedaron en estado de diagnostico manual. */
  permanentlyFailedCount: number;
}

function emptyCounts(): CatchupCountsSnapshot {
  return { threadsProcessed: 0, autoCreated: 0, autoUpdated: 0, delegated: 0, waiting: 0, noOp: 0, ignored: 0, review: 0, failed: 0, ruleFiltered: 0 };
}

function emptyUsage(): AiUsageSnapshot {
  return { calls: 0, inputTokens: 0, outputTokens: 0 };
}

function bumpCounts(counts: CatchupCountsSnapshot, entry: ThreadSyncLogEntry): void {
  counts.threadsProcessed += 1;
  switch (classifyThreadOutcome(entry)) {
    case "AUTO_CREATED":
      counts.autoCreated += 1;
      break;
    case "AUTO_UPDATED":
      counts.autoUpdated += 1;
      break;
    case "NO_OP":
      counts.noOp += 1;
      break;
    case "REVIEW_CREATED":
      counts.review += 1;
      break;
    case "IGNORED":
      counts.ignored += 1;
      break;
    case "RULE_FILTERED":
      counts.ruleFiltered += 1;
      break;
    case "FAILED":
      counts.failed += 1;
      break;
  }
  if (entry.classification === "WAITING" && (entry.action === "AUTO_CREATE" || entry.action === "AUTO_UPDATE")) {
    counts.waiting += 1;
  }
  if (entry.attentionOwner === "TEAM_OTHER" && entry.teamOtherRelation === "DELEGATED_BY_FELIPE" && (entry.action === "AUTO_CREATE" || entry.action === "AUTO_UPDATE")) {
    counts.delegated += 1;
  }
}

export async function getCatchupState(supabase: DB, connectionId: string): Promise<GmailCatchupStateRow | null> {
  const { data, error } = await supabase.from("gmail_catchup_state").select("*").eq("connection_id", connectionId).maybeSingle();
  if (error) throw error;
  return (data as GmailCatchupStateRow | null) ?? null;
}

/** Arranca (o re-arranca) un catch-up: construye la cola de threads UNA sola vez (orden
 * fijo, para que sea deterministico y resumible) y guarda el historyId ACTUAL de Gmail.
 * Ese historyId se convierte en el cursor incremental normal recien cuando el catch-up
 * termina (ver finalizeCatchup) — asi no se pierde actividad nueva que haya llegado
 * mientras el catch-up estaba en curso; el sync incremental la agarra despues sola. */
async function startCatchup(supabase: DB, gmail: gmail_v1.Gmail, connectionId: string, days: number): Promise<GmailCatchupStateRow> {
  const [threadIds, targetHistoryId] = await Promise.all([listThreadIdsSinceDays(gmail, days), getCurrentHistoryId(gmail)]);

  const fields = {
    connection_id: connectionId,
    status: "in_progress" as const,
    thread_queue: threadIds,
    cursor_index: 0,
    processed_count: 0,
    auto_created_count: 0,
    auto_updated_count: 0,
    delegated_count: 0,
    waiting_count: 0,
    no_op_count: 0,
    review_count: 0,
    ignored_count: 0,
    rule_filtered_count: 0,
    failed_count: 0,
    failed_threads: [] as FailedThreadEntry[],
    permanently_failed_threads: [] as FailedThreadEntry[],
    target_history_id: targetHistoryId,
    worker_locked_at: null,
    worker_id: null,
    ai_calls_count: 0,
    ai_input_tokens: 0,
    ai_output_tokens: 0,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
  };

  const { data, error } = await supabase.from("gmail_catchup_state").upsert(fields, { onConflict: "connection_id" }).select().single();
  if (error) throw error;
  return data as GmailCatchupStateRow;
}

/** El catch-up termino de recorrer toda la cola: recien ahi se actualiza el cursor
 * incremental normal (google_connection.history_id) al historyId capturado al ARRANCAR. */
async function finalizeCatchup(supabase: DB, connection: GoogleConnectionRow, targetHistoryId: string | null): Promise<void> {
  if (targetHistoryId) {
    await updateSyncCursor(supabase, connection.id, targetHistoryId);
  }
}

function errorClassOf(err: unknown): string {
  if (err instanceof Error) return err.name || "Error";
  return "UnknownError";
}

interface ProcessOneResult {
  entry: ThreadSyncLogEntry | null;
  errorClass: string | null;
}

async function processOneThread(
  gmail: gmail_v1.Gmail,
  applyDeps: ApplySyncDeps,
  userAddresses: string[],
  threadId: string
): Promise<ProcessOneResult> {
  try {
    const raw = await getThread(gmail, threadId);
    const thread = parseThread(raw, userAddresses);
    const entry = await processThread(applyDeps, thread);
    return { entry, errorClass: null };
  } catch (err) {
    console.error(`[catchup] thread ${threadId} fallo:`, err);
    return { entry: null, errorClass: errorClassOf(err) };
  }
}

function isLockActive(lockedAt: string | null): boolean {
  if (!lockedAt) return false;
  return Date.now() - new Date(lockedAt).getTime() < CATCHUP_LOCK_TTL_MS;
}

/**
 * Lock deliberadamente simple (fetch-then-update, no una CAS atomica de Postgres): alcanza
 * para el caso real que hay que cubrir — dos clicks de "Run catch-up", o dos pestañas del
 * mismo usuario — y evita la complejidad de un lock distribuido de verdad. Ventana de carrera
 * teorica minima entre el chequeo y el update; en el peor caso dos workers procesan el mismo
 * thread una vez cada uno, lo cual processThread ya tolera (idempotente por thread_id). Si el
 * worker que lo tomo murio, el lock expira solo a los CATCHUP_LOCK_TTL_MS — nunca eterno. */
async function acquireLock(supabase: DB, connectionId: string, workerId: string, currentLockedAt: string | null): Promise<void> {
  if (isLockActive(currentLockedAt)) {
    throw new CatchupLockError();
  }
  const { error } = await supabase
    .from("gmail_catchup_state")
    .update({ worker_locked_at: new Date().toISOString(), worker_id: workerId })
    .eq("connection_id", connectionId);
  if (error) throw error;
}

/** Solo libera si el lock sigue siendo de ESTE worker — evita pisar el lock de una ejecucion
 * mas nueva si, por ejemplo, esta tardo mas que el TTL y otro worker ya lo tomo. */
async function releaseLock(supabase: DB, connectionId: string, workerId: string): Promise<void> {
  await supabase
    .from("gmail_catchup_state")
    .update({ worker_locked_at: null, worker_id: null })
    .eq("connection_id", connectionId)
    .eq("worker_id", workerId);
}

/**
 * Mecanismo pedido explicitamente para recuperar threads que fallaron ANTES de que existiera
 * failed_threads (ver incidente real: 2 threads — 19ff6b03c397a27d y 19ff6a4988250a14 —
 * fallaron por el bug de schema de attention_owner, ya corregido, y el cursor ya los paso de
 * largo sin dejar rastro en la cola de reintento nueva). Los agrega a failed_threads con
 * attempts=0 (arrancan con el presupuesto completo de MAX_RETRY_ATTEMPTS, dado que la causa
 * raiz ya esta arreglada) para que el proximo lote los reintente PRIMERO, igual que cualquier
 * otro FAILED_RETRYABLE. No reprocesa el resto del backlog — solo estos threads puntuales.
 * Si el thread ya esta en failed_threads no lo duplica; si estaba en permanently_failed_threads
 * lo saca de ahi (le da otra chance manual explicita). */
export async function manualRequeueFailedThread(supabase: DB, connectionId: string, threadId: string, note: string): Promise<void> {
  const state = await getCatchupState(supabase, connectionId);
  if (!state) {
    throw new Error(`No hay gmail_catchup_state para la conexion ${connectionId} — no se puede hacer requeue de ${threadId}.`);
  }

  const alreadyRetryable = (state.failed_threads ?? []).some((f) => f.threadId === threadId);
  if (alreadyRetryable) return;

  const nowISO = new Date().toISOString();
  const entry: FailedThreadEntry = { threadId, attempts: 0, lastErrorClass: note, firstFailedAt: nowISO, lastFailedAt: nowISO };
  const nextFailedThreads = [...(state.failed_threads ?? []), entry];
  const nextPermanentlyFailed = (state.permanently_failed_threads ?? []).filter((f) => f.threadId !== threadId);

  const { error } = await supabase
    .from("gmail_catchup_state")
    .update({ failed_threads: nextFailedThreads, permanently_failed_threads: nextPermanentlyFailed, updated_at: nowISO })
    .eq("connection_id", connectionId);
  if (error) throw error;
}

/**
 * Procesa el siguiente lote (25 threads o 45s de presupuesto, lo que pase primero) del
 * catch-up en curso — nunca un sync monolitico sin checkpoint. Si no hay uno en curso (o el
 * anterior ya termino/nunca arranco), arranca uno nuevo antes de procesar. Persiste
 * cursor_index + contadores DESPUES del lote: si el proceso muere a mitad (timeout, Anthropic
 * caido), la proxima corrida sigue exactamente desde ahi — nunca reprocesa desde cero.
 *
 * Cada lote reintenta PRIMERO los threads en failed_threads (hasta MAX_RETRY_ATTEMPTS), antes
 * de seguir avanzando el cursor principal — un thread que fallo por un problema transitorio
 * vuelve a entrar solo, nunca queda saltado para siempre. Si agota los reintentos, pasa a
 * permanently_failed_threads (fuera del flujo automatico, para diagnostico manual) — nunca
 * loop infinito.
 *
 * Toma un lock simple (worker_locked_at/worker_id) antes de procesar y lo libera al terminar
 * (siempre, incluso si algo tira una excepcion) — evita que dos ejecuciones concurrentes
 * (dos pestañas del panel de Settings, dos clicks) procesen el mismo lote a la vez. Si el
 * lock esta activo, tira CatchupLockError (la API route lo traduce a 409).
 *
 * Idempotente por diseño: cada thread pasa por el mismo processThread() de siempre, que ya
 * resuelve por thread_id (findWorkItemByThreadId) — reprocesar un thread ya hecho actualiza,
 * nunca duplica. Pensado para llamarse repetidas veces en secuencia (nunca en paralelo) desde
 * el loop de auto-continue del panel de Settings — UNA request por vez.
 */
export async function runCatchupBatch(
  supabase: DB,
  connection: GoogleConnectionRow,
  options: { batchSize?: number; timeBudgetMs?: number; days?: number; workerId?: string } = {}
): Promise<CatchupBatchResult> {
  const batchSize = options.batchSize ?? DEFAULT_CATCHUP_BATCH_SIZE;
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_CATCHUP_TIME_BUDGET_MS;
  const days = options.days ?? DEFAULT_CATCHUP_WINDOW_DAYS;
  const workerId = options.workerId ?? randomUUID();

  const authClient = await getAuthorizedGmailClient(connection);
  const gmail = getGmailApi(authClient);

  let state = await getCatchupState(supabase, connection.id);
  if (!state || state.status !== "in_progress") {
    state = await startCatchup(supabase, gmail, connection.id, days);
  }

  await acquireLock(supabase, connection.id, workerId, state.worker_locked_at ?? null);
  try {
    return await runBatchLocked(supabase, connection, gmail, state, { batchSize, timeBudgetMs, days });
  } finally {
    await releaseLock(supabase, connection.id, workerId);
  }
}

async function runBatchLocked(
  supabase: DB,
  connection: GoogleConnectionRow,
  gmail: gmail_v1.Gmail,
  state: GmailCatchupStateRow,
  options: { batchSize: number; timeBudgetMs: number; days: number }
): Promise<CatchupBatchResult> {
  const { batchSize, timeBudgetMs } = options;
  const batchStartedAt = Date.now();

  const totalCounts: CatchupCountsSnapshot = {
    threadsProcessed: state.processed_count,
    autoCreated: state.auto_created_count,
    autoUpdated: state.auto_updated_count,
    delegated: state.delegated_count,
    waiting: state.waiting_count,
    noOp: state.no_op_count,
    review: state.review_count,
    ignored: state.ignored_count,
    ruleFiltered: state.rule_filtered_count,
    failed: state.failed_count,
  };
  const totalUsage: AiUsageSnapshot = {
    calls: state.ai_calls_count,
    inputTokens: state.ai_input_tokens,
    outputTokens: state.ai_output_tokens,
  };
  const batchCounts = emptyCounts();
  const batchUsage = emptyUsage();
  const batchEntries: ThreadSyncLogEntry[] = [];
  let failedThreads: FailedThreadEntry[] = [...(state.failed_threads ?? [])];
  const permanentlyFailedThreads: FailedThreadEntry[] = [...(state.permanently_failed_threads ?? [])];

  if (state.thread_queue.length === 0 && failedThreads.length === 0) {
    await finalizeCatchup(supabase, connection, state.target_history_id);
    await supabase
      .from("gmail_catchup_state")
      .update({ status: "completed", updated_at: new Date().toISOString(), completed_at: new Date().toISOString() })
      .eq("connection_id", connection.id);
    return buildResult(
      "completed",
      batchCounts,
      totalCounts,
      batchUsage,
      totalUsage,
      Date.now() - batchStartedAt,
      batchEntries,
      state.thread_queue.length,
      state.cursor_index,
      failedThreads,
      permanentlyFailedThreads
    );
  }

  const userAddresses = getUserAddresses();
  const aiProvider = getAIProvider();
  const todayISO = todayInTimezone();
  const onAiUsage = (usage: AiUsage) => {
    batchUsage.calls += 1;
    batchUsage.inputTokens += usage.inputTokens;
    batchUsage.outputTokens += usage.outputTokens;
  };
  const applyDeps: ApplySyncDeps = { supabase, aiProvider, todayISO, safeMode: connection.safe_mode, userAddresses, onAiUsage };

  const startedAt = Date.now();
  let processedThisBatch = 0;
  const withinBudget = () => processedThisBatch < batchSize && Date.now() - startedAt < timeBudgetMs;

  // --- 1. Reintentar primero los threads en la cola de reintento ---
  const stillFailedThreads: FailedThreadEntry[] = [];
  for (const failedEntry of failedThreads) {
    if (!withinBudget()) {
      stillFailedThreads.push(failedEntry);
      continue;
    }
    const { entry, errorClass } = await processOneThread(gmail, applyDeps, userAddresses, failedEntry.threadId);
    processedThisBatch += 1;
    if (entry) {
      bumpCounts(totalCounts, entry);
      bumpCounts(batchCounts, entry);
      batchEntries.push(entry);
      // se recupero — sale de la cola de reintento sin pasar a permanent.
    } else {
      const attempts = failedEntry.attempts + 1;
      const nowISO = new Date().toISOString();
      if (attempts >= MAX_RETRY_ATTEMPTS) {
        permanentlyFailedThreads.push({ ...failedEntry, attempts, lastErrorClass: errorClass ?? "UnknownError", lastFailedAt: nowISO });
      } else {
        stillFailedThreads.push({ ...failedEntry, attempts, lastErrorClass: errorClass ?? "UnknownError", lastFailedAt: nowISO });
      }
      totalCounts.failed += 1;
      batchCounts.failed += 1;
    }
  }
  failedThreads = stillFailedThreads;

  // --- 2. Continuar la cola principal desde cursor_index ---
  let cursorIndex = state.cursor_index;
  while (cursorIndex < state.thread_queue.length && withinBudget()) {
    const threadId = state.thread_queue[cursorIndex];
    if (!threadId) {
      cursorIndex += 1;
      continue;
    }
    const { entry, errorClass } = await processOneThread(gmail, applyDeps, userAddresses, threadId);
    processedThisBatch += 1;
    if (entry) {
      bumpCounts(totalCounts, entry);
      bumpCounts(batchCounts, entry);
      batchEntries.push(entry);
    } else {
      const nowISO = new Date().toISOString();
      failedThreads.push({ threadId, attempts: 1, lastErrorClass: errorClass ?? "UnknownError", firstFailedAt: nowISO, lastFailedAt: nowISO });
      totalCounts.failed += 1;
      batchCounts.failed += 1;
    }
    cursorIndex += 1;
  }

  totalUsage.calls += batchUsage.calls;
  totalUsage.inputTokens += batchUsage.inputTokens;
  totalUsage.outputTokens += batchUsage.outputTokens;

  const completed = cursorIndex >= state.thread_queue.length && failedThreads.length === 0;

  const { error: updateError } = await supabase
    .from("gmail_catchup_state")
    .update({
      cursor_index: cursorIndex,
      processed_count: totalCounts.threadsProcessed,
      auto_created_count: totalCounts.autoCreated,
      auto_updated_count: totalCounts.autoUpdated,
      delegated_count: totalCounts.delegated,
      waiting_count: totalCounts.waiting,
      no_op_count: totalCounts.noOp,
      review_count: totalCounts.review,
      ignored_count: totalCounts.ignored,
      rule_filtered_count: totalCounts.ruleFiltered,
      failed_count: totalCounts.failed,
      failed_threads: failedThreads,
      permanently_failed_threads: permanentlyFailedThreads,
      ai_calls_count: totalUsage.calls,
      ai_input_tokens: totalUsage.inputTokens,
      ai_output_tokens: totalUsage.outputTokens,
      status: completed ? "completed" : "in_progress",
      updated_at: new Date().toISOString(),
      completed_at: completed ? new Date().toISOString() : null,
    })
    .eq("connection_id", connection.id);
  if (updateError) throw updateError;

  if (completed) {
    await finalizeCatchup(supabase, connection, state.target_history_id);
  }

  return buildResult(
    completed ? "completed" : "in_progress",
    batchCounts,
    totalCounts,
    batchUsage,
    totalUsage,
    Date.now() - batchStartedAt,
    batchEntries,
    state.thread_queue.length,
    cursorIndex,
    failedThreads,
    permanentlyFailedThreads
  );
}

function buildResult(
  status: "in_progress" | "completed",
  batchCounts: CatchupCountsSnapshot,
  totalCounts: CatchupCountsSnapshot,
  batchUsage: AiUsageSnapshot,
  totalUsage: AiUsageSnapshot,
  durationMs: number,
  entries: ThreadSyncLogEntry[],
  queueLength: number,
  cursorIndex: number,
  failedThreads: FailedThreadEntry[],
  permanentlyFailedThreads: FailedThreadEntry[]
): CatchupBatchResult {
  return {
    status,
    thisBatch: { ...batchCounts, durationMs, aiUsage: batchUsage },
    total: { ...totalCounts, pending: queueLength - cursorIndex + failedThreads.length, queueLength, aiUsage: totalUsage },
    entries,
    retryableFailedCount: failedThreads.length,
    permanentlyFailedCount: permanentlyFailedThreads.length,
  };
}
