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

export interface CatchupBatchResult {
  status: "in_progress" | "completed" | "failed";
  pending: number;
  processedThisBatch: number;
  processedTotal: number;
  autoCreated: number;
  autoUpdated: number;
  noOp: number;
  review: number;
  ignored: number;
  ruleFiltered: number;
  failed: number;
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
    no_op_count: 0,
    review_count: 0,
    ignored_count: 0,
    rule_filtered_count: 0,
    failed_count: 0,
    target_history_id: targetHistoryId,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
  };

  const { data, error } = await supabase.from("gmail_catchup_state").upsert(fields, { onConflict: "connection_id" }).select().single();
  if (error) throw error;
  return data as GmailCatchupStateRow;
}

interface CatchupCounts {
  processed: number;
  autoCreated: number;
  autoUpdated: number;
  noOp: number;
  review: number;
  ignored: number;
  ruleFiltered: number;
  failed: number;
}

function bumpCounts(counts: CatchupCounts, entry: ThreadSyncLogEntry): void {
  counts.processed += 1;
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
}

/** El catch-up termino de recorrer toda la cola: recien ahi se actualiza el cursor
 * incremental normal (google_connection.history_id) al historyId capturado al ARRANCAR. */
async function finalizeCatchup(supabase: DB, connection: GoogleConnectionRow, targetHistoryId: string | null): Promise<void> {
  if (targetHistoryId) {
    await updateSyncCursor(supabase, connection.id, targetHistoryId);
  }
}

/**
 * Procesa el siguiente lote (25 threads o 45s de presupuesto, lo que pase primero) del
 * catch-up en curso — nunca un sync monolitico sin checkpoint. Si no hay uno en curso (o el
 * anterior ya termino/nunca arranco), arranca uno nuevo antes de procesar. Persiste
 * cursor_index + contadores DESPUES del lote: si el proceso muere a mitad (timeout, Anthropic
 * caido), la proxima corrida sigue exactamente desde ahi — nunca reprocesa desde cero.
 * Idempotente por diseño: cada thread pasa por el mismo processThread() de siempre, que ya
 * resuelve por thread_id (findWorkItemByThreadId) — reprocesar un thread ya hecho (ej. si
 * cursor_index quedo desalineado por algun motivo) actualiza, nunca duplica.
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

  const counts: CatchupCounts = {
    processed: state.processed_count,
    autoCreated: state.auto_created_count,
    autoUpdated: state.auto_updated_count,
    noOp: state.no_op_count,
    review: state.review_count,
    ignored: state.ignored_count,
    ruleFiltered: state.rule_filtered_count,
    failed: state.failed_count,
  };

  if (state.thread_queue.length === 0) {
    await finalizeCatchup(supabase, connection, state.target_history_id);
    await supabase
      .from("gmail_catchup_state")
      .update({ status: "completed", updated_at: new Date().toISOString(), completed_at: new Date().toISOString() })
      .eq("connection_id", connection.id);
    return { status: "completed", pending: 0, processedThisBatch: 0, processedTotal: counts.processed, ...countsToResult(counts) };
  }

  const userAddresses = getUserAddresses();
  const aiProvider = getAIProvider();
  const todayISO = todayInTimezone();
  const applyDeps: ApplySyncDeps = { supabase, aiProvider, todayISO, safeMode: connection.safe_mode, userAddresses };

  const startedAt = Date.now();
  let cursorIndex = state.cursor_index;
  let processedThisBatch = 0;

  while (cursorIndex < state.thread_queue.length && processedThisBatch < batchSize && Date.now() - startedAt < timeBudgetMs) {
    const threadId = state.thread_queue[cursorIndex];
    if (!threadId) {
      cursorIndex += 1;
      continue;
    }
    try {
      const raw = await getThread(gmail, threadId);
      const thread = parseThread(raw, userAddresses);
      const entry = await processThread(applyDeps, thread);
      bumpCounts(counts, entry);
    } catch (err) {
      console.error(`[catchup] thread ${threadId} fallo:`, err);
      counts.failed += 1;
      counts.processed += 1;
    }
    cursorIndex += 1;
    processedThisBatch += 1;
  }

  const completed = cursorIndex >= state.thread_queue.length;

  const { error: updateError } = await supabase
    .from("gmail_catchup_state")
    .update({
      cursor_index: cursorIndex,
      processed_count: counts.processed,
      auto_created_count: counts.autoCreated,
      auto_updated_count: counts.autoUpdated,
      no_op_count: counts.noOp,
      review_count: counts.review,
      ignored_count: counts.ignored,
      rule_filtered_count: counts.ruleFiltered,
      failed_count: counts.failed,
      status: completed ? "completed" : "in_progress",
      updated_at: new Date().toISOString(),
      completed_at: completed ? new Date().toISOString() : null,
    })
    .eq("connection_id", connection.id);
  if (updateError) throw updateError;

  if (completed) {
    await finalizeCatchup(supabase, connection, state.target_history_id);
  }

  return {
    status: completed ? "completed" : "in_progress",
    pending: state.thread_queue.length - cursorIndex,
    processedThisBatch,
    processedTotal: counts.processed,
    ...countsToResult(counts),
  };
}

function countsToResult(counts: CatchupCounts): Omit<CatchupBatchResult, "status" | "pending" | "processedThisBatch" | "processedTotal"> {
  return {
    autoCreated: counts.autoCreated,
    autoUpdated: counts.autoUpdated,
    noOp: counts.noOp,
    review: counts.review,
    ignored: counts.ignored,
    ruleFiltered: counts.ruleFiltered,
    failed: counts.failed,
  };
}
