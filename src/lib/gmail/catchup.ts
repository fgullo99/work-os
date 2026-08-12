import type { SupabaseClient } from "@supabase/supabase-js";
import type { gmail_v1 } from "googleapis";
import { getAuthorizedGmailClient } from "@/lib/google/oauthClient";
import { getGmailApi, getCurrentHistoryId, getThread, listThreadIdsSinceDays } from "./client";
import { parseThread } from "./threadParser";
import { processThread, type ApplySyncDeps, type ThreadSyncLogEntry } from "./applySync";
import { classifyThreadOutcome } from "./reconcile";
import { getAIProvider } from "@/lib/ai";
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

export interface FailedThreadEntry {
  threadId: string;
  attempts: number;
  lastErrorClass: string;
  firstFailedAt: string;
  lastFailedAt: string;
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

export interface CatchupBatchResult {
  status: "in_progress" | "completed";
  thisBatch: CatchupCountsSnapshot;
  total: CatchupCountsSnapshot & { pending: number; queueLength: number };
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

/**
 * Procesa el siguiente lote (25 threads o 45s de presupuesto, lo que pase primero) del
 * catch-up en curso — nunca un sync monolitico sin checkpoint. Si no hay uno en curso (o el
 * anterior ya termino/nunca arranco), arranca uno nuevo antes de procesar. Persiste
 * cursor_index + contadores DESPUES del lote: si el proceso muere a mitad (timeout, Anthropic
 * caido), la proxima corrida sigue exactamente desde ahi — nunca reprocesa desde cero.
 *
 * Cada lote reintenta PRIMERO los threads en failed_threads (hasta MAX_RETRY_ATTEMPTS), antes
 * de seguir avanzando el cursor principal — un thread que fallo por un problema transitorio
 * (ver incidente real: bug de schema, 2 threads fallaron) vuelve a entrar solo, nunca queda
 * saltado para siempre. Si agota los reintentos, pasa a permanently_failed_threads (fuera del
 * flujo automatico, para diagnostico manual) — nunca loop infinito.
 *
 * Idempotente por diseño: cada thread pasa por el mismo processThread() de siempre, que ya
 * resuelve por thread_id (findWorkItemByThreadId) — reprocesar un thread ya hecho actualiza,
 * nunca duplica.
 */
export async function runCatchupBatch(
  supabase: DB,
  connection: GoogleConnectionRow,
  options: { batchSize?: number; timeBudgetMs?: number; days?: number } = {}
): Promise<CatchupBatchResult> {
  const batchSize = options.batchSize ?? DEFAULT_CATCHUP_BATCH_SIZE;
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_CATCHUP_TIME_BUDGET_MS;
  const days = options.days ?? DEFAULT_CATCHUP_WINDOW_DAYS;

  const authClient = await getAuthorizedGmailClient(connection);
  const gmail = getGmailApi(authClient);

  let state = await getCatchupState(supabase, connection.id);
  if (!state || state.status !== "in_progress") {
    state = await startCatchup(supabase, gmail, connection.id, days);
  }

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
  const batchCounts = emptyCounts();
  const batchEntries: ThreadSyncLogEntry[] = [];
  let failedThreads: FailedThreadEntry[] = [...(state.failed_threads ?? [])];
  const permanentlyFailedThreads: FailedThreadEntry[] = [...(state.permanently_failed_threads ?? [])];

  if (state.thread_queue.length === 0 && failedThreads.length === 0) {
    await finalizeCatchup(supabase, connection, state.target_history_id);
    await supabase
      .from("gmail_catchup_state")
      .update({ status: "completed", updated_at: new Date().toISOString(), completed_at: new Date().toISOString() })
      .eq("connection_id", connection.id);
    return buildResult("completed", batchCounts, totalCounts, batchEntries, state.thread_queue.length, state.cursor_index, failedThreads, permanentlyFailedThreads);
  }

  const userAddresses = getUserAddresses();
  const aiProvider = getAIProvider();
  const todayISO = todayInTimezone();
  const applyDeps: ApplySyncDeps = { supabase, aiProvider, todayISO, safeMode: connection.safe_mode, userAddresses };

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
  entries: ThreadSyncLogEntry[],
  queueLength: number,
  cursorIndex: number,
  failedThreads: FailedThreadEntry[],
  permanentlyFailedThreads: FailedThreadEntry[]
): CatchupBatchResult {
  return {
    status,
    thisBatch: batchCounts,
    total: { ...totalCounts, pending: queueLength - cursorIndex + failedThreads.length, queueLength },
    entries,
    retryableFailedCount: failedThreads.length,
    permanentlyFailedCount: permanentlyFailedThreads.length,
  };
}
