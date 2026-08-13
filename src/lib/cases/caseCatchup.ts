import type { SupabaseClient } from "@supabase/supabase-js";
import type { gmail_v1 } from "googleapis";
import { randomUUID } from "node:crypto";
import { getAuthorizedGmailClient } from "@/lib/google/oauthClient";
import { getGmailApi, getThread } from "@/lib/gmail/client";
import { parseThread } from "@/lib/gmail/threadParser";
import {
  getCatchupState as getGmailCatchupState,
  DEFAULT_CATCHUP_BATCH_SIZE,
  DEFAULT_CATCHUP_TIME_BUDGET_MS,
  MAX_RETRY_ATTEMPTS,
  CATCHUP_LOCK_TTL_MS,
  CatchupLockError,
  type FailedThreadEntry,
} from "@/lib/gmail/catchup";
import { processThreadForCase, type CaseAnalysisDeps, type CaseSyncLogEntry } from "./caseAnalysis";
import { getAIProvider, type AiUsage } from "@/lib/ai";
import { todayInTimezone } from "@/lib/dates/timezone";
import { getUserAddresses } from "@/lib/gmail/sync";
import { getInternalTeamMembers } from "./teamMembers";
import type { GoogleConnectionRow, CaseCatchupStateRow } from "@/lib/supabase/types";

type DB = SupabaseClient;

export { CatchupLockError };

export interface CaseCatchupCountsSnapshot {
  threadsProcessed: number;
  casesCreated: number;
  threadsMerged: number;
  caseMergeReview: number;
  caseStateReview: number;
  noOp: number;
  ignored: number;
  ruleFiltered: number;
  failed: number;
}

export interface AiUsageSnapshot {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CaseCatchupBatchResult {
  status: "in_progress" | "completed";
  thisBatch: CaseCatchupCountsSnapshot & { durationMs: number; aiUsage: AiUsageSnapshot };
  total: CaseCatchupCountsSnapshot & { pending: number; queueLength: number; aiUsage: AiUsageSnapshot };
  entries: CaseSyncLogEntry[];
  retryableFailedCount: number;
  permanentlyFailedCount: number;
}

function emptyCounts(): CaseCatchupCountsSnapshot {
  return { threadsProcessed: 0, casesCreated: 0, threadsMerged: 0, caseMergeReview: 0, caseStateReview: 0, noOp: 0, ignored: 0, ruleFiltered: 0, failed: 0 };
}

function emptyUsage(): AiUsageSnapshot {
  return { calls: 0, inputTokens: 0, outputTokens: 0 };
}

export type CaseThreadOutcomeBucket =
  | "CASES_CREATED"
  | "THREADS_MERGED"
  | "CASE_MERGE_REVIEW"
  | "CASE_STATE_REVIEW"
  | "IGNORED"
  | "RULE_FILTERED"
  | "FAILED";

/** Unica fuente de verdad para bucketizar el resultado de processThreadForCase — mismo
 * espiritu que classifyThreadOutcome en gmail/reconcile.ts. */
export function classifyCaseThreadOutcome(entry: CaseSyncLogEntry): CaseThreadOutcomeBucket {
  if (entry.ruleFilterSkipped) return "RULE_FILTERED";
  if (entry.action === "AUTO_CREATE_CASE") return "CASES_CREATED";
  if (entry.action === "AUTO_MERGE") return "THREADS_MERGED";
  if (entry.action === "CASE_MERGE_REVIEW") return "CASE_MERGE_REVIEW";
  if (entry.action === "CASE_STATE_REVIEW") return "CASE_STATE_REVIEW";
  return "IGNORED";
}

/** Misma logica que processedUniqueOf en gmail/catchup.ts: suma de los buckets de resultado
 * REAL (nunca cursor_index ni un contador acumulado aparte) — evita el mismo drift ya vivido
 * y corregido en el catch-up de Gmail. */
function processedUniqueOf(counts: CaseCatchupCountsSnapshot): number {
  return counts.casesCreated + counts.threadsMerged + counts.caseMergeReview + counts.caseStateReview + counts.noOp + counts.ignored + counts.ruleFiltered;
}

function bumpCounts(counts: CaseCatchupCountsSnapshot, entry: CaseSyncLogEntry): void {
  counts.threadsProcessed += 1;
  switch (classifyCaseThreadOutcome(entry)) {
    case "CASES_CREATED":
      counts.casesCreated += 1;
      break;
    case "THREADS_MERGED":
      counts.threadsMerged += 1;
      break;
    case "CASE_MERGE_REVIEW":
      counts.caseMergeReview += 1;
      break;
    case "CASE_STATE_REVIEW":
      counts.caseStateReview += 1;
      break;
    case "RULE_FILTERED":
      counts.ruleFiltered += 1;
      break;
    case "IGNORED":
      counts.ignored += 1;
      break;
  }
}

export async function getCaseCatchupState(supabase: DB, connectionId: string): Promise<CaseCatchupStateRow | null> {
  const { data, error } = await supabase.from("case_catchup_state").select("*").eq("connection_id", connectionId).maybeSingle();
  if (error) throw error;
  return (data as CaseCatchupStateRow | null) ?? null;
}

/** Siembra la cola del catch-up de Cases LEYENDO gmail_catchup_state (nunca escribiendolo) —
 * item 40 del pedido: reusar el backlog pendiente del catch-up viejo, sin reprocesar lo que
 * el pipeline de Work Item ya proceso. Cola = threads que el catch-up viejo TODAVIA no llego
 * a tocar (thread_queue.slice(cursor_index)) + los que habian quedado en su cola de reintento
 * (failed_threads) — nunca los que ya agotaron reintentos ahi (permanently_failed_threads,
 * quedan para diagnostico manual aparte, no se les da una tercera vida silenciosa). */
async function seedFromGmailBacklog(supabase: DB, connectionId: string): Promise<string[]> {
  const gmailState = await getGmailCatchupState(supabase, connectionId);
  if (!gmailState) return [];
  const pending = gmailState.thread_queue.slice(gmailState.cursor_index);
  const retryable = (gmailState.failed_threads ?? []).map((f) => f.threadId);
  return Array.from(new Set([...pending, ...retryable]));
}

async function startCaseCatchup(supabase: DB, connectionId: string): Promise<CaseCatchupStateRow> {
  const threadQueue = await seedFromGmailBacklog(supabase, connectionId);
  const fields = {
    connection_id: connectionId,
    status: "in_progress" as const,
    thread_queue: threadQueue,
    cursor_index: 0,
    processed_count: 0,
    cases_created_count: 0,
    threads_merged_count: 0,
    case_merge_review_count: 0,
    case_state_review_count: 0,
    no_op_count: 0,
    ignored_count: 0,
    rule_filtered_count: 0,
    failed_count: 0,
    failed_threads: [] as FailedThreadEntry[],
    permanently_failed_threads: [] as FailedThreadEntry[],
    worker_locked_at: null,
    worker_id: null,
    ai_calls_count: 0,
    ai_input_tokens: 0,
    ai_output_tokens: 0,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
  };
  const { data, error } = await supabase.from("case_catchup_state").upsert(fields, { onConflict: "connection_id" }).select().single();
  if (error) throw error;
  return data as CaseCatchupStateRow;
}

function errorClassOf(err: unknown): string {
  if (err instanceof Error) return err.name || "Error";
  return "UnknownError";
}

interface ProcessOneResult {
  entry: CaseSyncLogEntry | null;
  errorClass: string | null;
}

async function processOneThread(
  gmail: gmail_v1.Gmail,
  deps: CaseAnalysisDeps,
  userAddresses: string[],
  threadId: string
): Promise<ProcessOneResult> {
  try {
    const raw = await getThread(gmail, threadId);
    const thread = parseThread(raw, userAddresses);
    const entry = await processThreadForCase(deps, thread);
    return { entry, errorClass: null };
  } catch (err) {
    console.error(`[caseCatchup] thread ${threadId} fallo:`, err);
    return { entry: null, errorClass: errorClassOf(err) };
  }
}

function isLockActive(lockedAt: string | null): boolean {
  if (!lockedAt) return false;
  return Date.now() - new Date(lockedAt).getTime() < CATCHUP_LOCK_TTL_MS;
}

async function acquireLock(supabase: DB, connectionId: string, workerId: string, currentLockedAt: string | null): Promise<void> {
  if (isLockActive(currentLockedAt)) throw new CatchupLockError();
  const { error } = await supabase
    .from("case_catchup_state")
    .update({ worker_locked_at: new Date().toISOString(), worker_id: workerId })
    .eq("connection_id", connectionId);
  if (error) throw error;
}

async function releaseLock(supabase: DB, connectionId: string, workerId: string): Promise<void> {
  await supabase
    .from("case_catchup_state")
    .update({ worker_locked_at: null, worker_id: null })
    .eq("connection_id", connectionId)
    .eq("worker_id", workerId);
}

/**
 * Mirror de runCatchupBatch (gmail/catchup.ts) — mismo diseño de batch/lock/retry, duplicado
 * a proposito en vez de generalizado (ver plan: menos riesgo en una sola sesion dado el
 * historial de bugs reales ya vividos en el modulo original). Nunca escribe
 * gmail_catchup_state, solo lo lee UNA vez para sembrar la cola inicial (seedFromGmailBacklog).
 * Cada thread pasa por processThreadForCase() en vez de processThread() — nunca crea un Work
 * Item (item 29).
 */
export async function runCaseCatchupBatch(
  supabase: DB,
  connection: GoogleConnectionRow,
  options: { batchSize?: number; timeBudgetMs?: number; workerId?: string } = {}
): Promise<CaseCatchupBatchResult> {
  const batchSize = options.batchSize ?? DEFAULT_CATCHUP_BATCH_SIZE;
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_CATCHUP_TIME_BUDGET_MS;
  const workerId = options.workerId ?? randomUUID();

  const authClient = await getAuthorizedGmailClient(connection);
  const gmail = getGmailApi(authClient);

  let state = await getCaseCatchupState(supabase, connection.id);
  if (!state || state.status !== "in_progress") {
    state = await startCaseCatchup(supabase, connection.id);
  }

  await acquireLock(supabase, connection.id, workerId, state.worker_locked_at ?? null);
  try {
    return await runBatchLocked(supabase, connection, gmail, state, { batchSize, timeBudgetMs });
  } finally {
    await releaseLock(supabase, connection.id, workerId);
  }
}

async function runBatchLocked(
  supabase: DB,
  connection: GoogleConnectionRow,
  gmail: gmail_v1.Gmail,
  state: CaseCatchupStateRow,
  options: { batchSize: number; timeBudgetMs: number }
): Promise<CaseCatchupBatchResult> {
  const { batchSize, timeBudgetMs } = options;
  const batchStartedAt = Date.now();

  const totalCounts: CaseCatchupCountsSnapshot = {
    threadsProcessed: 0,
    casesCreated: state.cases_created_count,
    threadsMerged: state.threads_merged_count,
    caseMergeReview: state.case_merge_review_count,
    caseStateReview: state.case_state_review_count,
    noOp: state.no_op_count,
    ignored: state.ignored_count,
    ruleFiltered: state.rule_filtered_count,
    failed: state.failed_count,
  };
  totalCounts.threadsProcessed = processedUniqueOf(totalCounts);
  const totalUsage: AiUsageSnapshot = { calls: state.ai_calls_count, inputTokens: state.ai_input_tokens, outputTokens: state.ai_output_tokens };
  const batchCounts = emptyCounts();
  const batchUsage = emptyUsage();
  const batchEntries: CaseSyncLogEntry[] = [];
  let failedThreads: FailedThreadEntry[] = [...(state.failed_threads ?? [])];
  const permanentlyFailedThreads: FailedThreadEntry[] = [...(state.permanently_failed_threads ?? [])];

  if (state.thread_queue.length === 0 && failedThreads.length === 0) {
    await supabase
      .from("case_catchup_state")
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
      failedThreads,
      permanentlyFailedThreads
    );
  }

  const userAddresses = getUserAddresses();
  const internalTeamMembers = getInternalTeamMembers();
  const aiProvider = getAIProvider();
  const todayISO = todayInTimezone();
  const onAiUsage = (usage: AiUsage) => {
    batchUsage.calls += 1;
    batchUsage.inputTokens += usage.inputTokens;
    batchUsage.outputTokens += usage.outputTokens;
  };
  const deps: CaseAnalysisDeps = {
    supabase,
    aiProvider,
    todayISO,
    safeMode: connection.safe_mode,
    userAddresses,
    internalTeamMembers,
    onAiUsage,
  };

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
    const { entry, errorClass } = await processOneThread(gmail, deps, userAddresses, failedEntry.threadId);
    processedThisBatch += 1;
    if (entry) {
      bumpCounts(totalCounts, entry);
      bumpCounts(batchCounts, entry);
      batchEntries.push(entry);
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
    const { entry, errorClass } = await processOneThread(gmail, deps, userAddresses, threadId);
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
  totalCounts.threadsProcessed = processedUniqueOf(totalCounts);

  const { error: updateError } = await supabase
    .from("case_catchup_state")
    .update({
      cursor_index: cursorIndex,
      processed_count: totalCounts.threadsProcessed,
      cases_created_count: totalCounts.casesCreated,
      threads_merged_count: totalCounts.threadsMerged,
      case_merge_review_count: totalCounts.caseMergeReview,
      case_state_review_count: totalCounts.caseStateReview,
      no_op_count: totalCounts.noOp,
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

  return buildResult(
    completed ? "completed" : "in_progress",
    batchCounts,
    totalCounts,
    batchUsage,
    totalUsage,
    Date.now() - batchStartedAt,
    batchEntries,
    state.thread_queue.length,
    failedThreads,
    permanentlyFailedThreads
  );
}

function buildResult(
  status: "in_progress" | "completed",
  batchCounts: CaseCatchupCountsSnapshot,
  totalCounts: CaseCatchupCountsSnapshot,
  batchUsage: AiUsageSnapshot,
  totalUsage: AiUsageSnapshot,
  durationMs: number,
  entries: CaseSyncLogEntry[],
  queueLength: number,
  failedThreads: FailedThreadEntry[],
  permanentlyFailedThreads: FailedThreadEntry[]
): CaseCatchupBatchResult {
  const pending = queueLength - totalCounts.threadsProcessed - permanentlyFailedThreads.length;
  return {
    status,
    thisBatch: { ...batchCounts, durationMs, aiUsage: batchUsage },
    total: { ...totalCounts, pending, queueLength, aiUsage: totalUsage },
    entries,
    retryableFailedCount: failedThreads.length,
    permanentlyFailedCount: permanentlyFailedThreads.length,
  };
}
