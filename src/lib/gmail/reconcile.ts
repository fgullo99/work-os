import type { SupabaseClient } from "@supabase/supabase-js";
import type { gmail_v1 } from "googleapis";
import { getAuthorizedGmailClient } from "@/lib/google/oauthClient";
import { getGmailApi, getThread, getThreadVersion, listThreadIdsSinceDays } from "./client";
import { parseThread } from "./threadParser";
import { processThread, type ApplySyncDeps, type ThreadSyncLogEntry } from "./applySync";
import { getAIProvider } from "@/lib/ai";
import { todayInTimezone } from "@/lib/dates/timezone";
import { getUserAddresses } from "./sync";
import { updateLastReconciliationSummary } from "@/lib/google/connection";
import type { GoogleConnectionRow } from "@/lib/supabase/types";

type DB = SupabaseClient;

/** No re-chequear el mismo candidato si ya se reviso hace menos de esto — evita trabajo
 * duplicado si la reconciliacion corre encadenada al sync Y por disparo manual/cron cerca
 * en el tiempo. La decision real de "hace falta re-analizar con IA" es el fingerprint
 * (historyId), no este intervalo — este es solo un piso de seguridad. */
export const MIN_RECHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface ReconciliationCandidate {
  workItemId: string;
  threadId: string;
  lastReconciledAt: string | null;
  lastReconciledThreadVersion: string | null;
}

/**
 * Candidatos para Existing Item Reconciliation: Work Items activos (OPEN/DELEGATED)
 * linkeados a Gmail — ACTION y WAITING por igual (no se filtra por waiting_for_what, ver
 * ajuste del plan: un item ACTION cuyo thread recibe una respuesta que cambia todo tambien
 * tiene que reconciliarse). Ordenados con los nunca-reconciliados/mas viejos primero.
 */
export async function getReconciliationCandidates(supabase: DB): Promise<ReconciliationCandidate[]> {
  const { data: workItems, error: wiError } = await supabase
    .from("work_item")
    .select("id, last_reconciled_at, last_reconciled_thread_version")
    .in("status", ["OPEN", "DELEGATED"]);
  if (wiError) throw wiError;
  const activeIds = (workItems ?? []).map((w) => w.id as string);
  if (activeIds.length === 0) return [];

  const { data: links, error: slError } = await supabase
    .from("source_link")
    .select("work_item_id, external_id, occurred_at")
    .eq("source_type", "GMAIL")
    .in("work_item_id", activeIds)
    .order("occurred_at", { ascending: false });
  if (slError) throw slError;

  const threadByWorkItem = new Map<string, string>();
  for (const link of (links ?? []) as { work_item_id: string; external_id: string | null }[]) {
    if (!link.external_id) continue;
    if (!threadByWorkItem.has(link.work_item_id)) threadByWorkItem.set(link.work_item_id, link.external_id);
  }

  type WiRow = { id: string; last_reconciled_at: string | null; last_reconciled_thread_version: string | null };
  const wiMap = new Map((workItems ?? []).map((w) => [(w as WiRow).id, w as WiRow]));

  const candidates: ReconciliationCandidate[] = [];
  for (const [workItemId, threadId] of threadByWorkItem) {
    const wi = wiMap.get(workItemId);
    if (!wi) continue;
    candidates.push({
      workItemId,
      threadId,
      lastReconciledAt: wi.last_reconciled_at,
      lastReconciledThreadVersion: wi.last_reconciled_thread_version,
    });
  }
  candidates.sort((a, b) => (a.lastReconciledAt ?? "").localeCompare(b.lastReconciledAt ?? ""));
  return candidates;
}

/** Threads de Gmail con actividad en los ultimos `days` dias que todavia no tienen NINGUN
 * source_link (a ningun Work Item, sin importar su status) — candidatos a Unlinked Thread
 * Discovery. */
export async function getUnlinkedThreadCandidates(gmail: gmail_v1.Gmail, supabase: DB, days = 7): Promise<string[]> {
  const allThreadIds = await listThreadIdsSinceDays(gmail, days);
  if (allThreadIds.length === 0) return [];

  const { data: links, error } = await supabase
    .from("source_link")
    .select("external_id")
    .eq("source_type", "GMAIL")
    .in("external_id", allThreadIds);
  if (error) throw error;

  const linkedIds = new Set((links ?? []).map((l) => (l as { external_id: string | null }).external_id));
  return allThreadIds.filter((id) => !linkedIds.has(id));
}

function outcomeForEntry(entry: ThreadSyncLogEntry): string {
  if (entry.action === "ERROR") return "ERROR";
  if (entry.action === "AUTO_CREATE") return "CREATED";
  if (entry.action.startsWith("REVIEW") || entry.action.startsWith("WOULD_")) return "REVIEW";
  return "IGNORED";
}

export type ThreadOutcomeBucket = "AUTO_CREATED" | "AUTO_UPDATED" | "NO_OP" | "REVIEW_CREATED" | "IGNORED" | "RULE_FILTERED" | "FAILED";

/** Un solo lugar de verdad para clasificar el resultado de un thread en un balde
 * mutuamente excluyente — usado por runReconciliationSweep para las metricas DE ESTA
 * CORRIDA (nunca mezcladas con review_item historico, ver seccion "Metricas" del pedido).
 * RECEIVED_CHECK cuenta como REVIEW_CREATED: applySync.ts siempre crea un review_item para
 * el, nunca se auto-aplica. WOULD_* (safe_mode=true) tambien cuenta como REVIEW_CREATED:
 * es lo que realmente paso en la DB esta corrida (un review_item, no un auto-apply real). */
export function classifyThreadOutcome(entry: ThreadSyncLogEntry): ThreadOutcomeBucket {
  if (entry.action === "ERROR") return "FAILED";
  if (entry.ruleFilterSkipped) return "RULE_FILTERED";
  if (entry.action === "AUTO_CREATE") return "AUTO_CREATED";
  if (entry.action === "AUTO_UPDATE") return "AUTO_UPDATED";
  if (entry.action === "NO_OP") return "NO_OP";
  if (entry.action === "RECEIVED_CHECK") return "REVIEW_CREATED";
  if (entry.action.startsWith("REVIEW") || entry.action.startsWith("WOULD_")) return "REVIEW_CREATED";
  return "IGNORED";
}

export interface ReconcileDeps {
  supabase: DB;
  gmail: gmail_v1.Gmail;
  applyDeps: Omit<ApplySyncDeps, "supabase">;
  userAddresses: string[];
}

/** Re-examina UN Work Item existente contra el estado actual de su thread. Primero chequea
 * el fingerprint liviano (historyId, sin traer mensajes) — si no cambio desde la ultima vez,
 * no gasta IA, solo confirma la revision. Si cambio, corre processThread() completo (el
 * mismo pipeline del sync normal — nunca puede terminar en CREATE porque el thread ya esta
 * linkeado a este Work Item). Exportada para tests de idempotencia (reconcile.test.ts) — el
 * resto del modulo la usa sin importarla directamente. */
export async function reconcileCandidate(
  deps: ReconcileDeps,
  candidate: ReconciliationCandidate
): Promise<{ checked: boolean; entry: ThreadSyncLogEntry | null }> {
  if (candidate.lastReconciledAt) {
    const elapsed = Date.now() - new Date(candidate.lastReconciledAt).getTime();
    if (elapsed < MIN_RECHECK_INTERVAL_MS) return { checked: false, entry: null };
  }

  const currentVersion = await deps.gmail.users.threads
    .get({ userId: "me", id: candidate.threadId, format: "minimal" })
    .then((res) => res.data.historyId ?? null)
    .catch(() => null);

  const changed = candidate.lastReconciledThreadVersion === null || candidate.lastReconciledThreadVersion !== currentVersion;

  if (!changed) {
    await deps.supabase
      .from("work_item")
      .update({ last_reconciled_at: new Date().toISOString(), last_reconciled_thread_version: currentVersion })
      .eq("id", candidate.workItemId);
    return { checked: true, entry: null };
  }

  const raw = await getThread(deps.gmail, candidate.threadId);
  const thread = parseThread(raw, deps.userAddresses);
  const entry = await processThread({ supabase: deps.supabase, ...deps.applyDeps }, thread);

  await deps.supabase
    .from("work_item")
    .update({ last_reconciled_at: new Date().toISOString(), last_reconciled_thread_version: currentVersion })
    .eq("id", candidate.workItemId);

  return { checked: true, entry };
}

/** Evalua UN thread no linkeado. Mismo chequeo de fingerprint que reconcileCandidate, pero
 * contra gmail_thread_reconciliation (no hay Work Item todavia). Devuelve null si se salteo
 * (checkeado hace poco, o sin cambios desde la ultima vez). */
async function discoverThread(deps: ReconcileDeps, threadId: string): Promise<ThreadSyncLogEntry | null> {
  const { data: existingLog } = await deps.supabase
    .from("gmail_thread_reconciliation")
    .select("*")
    .eq("thread_id", threadId)
    .maybeSingle();

  if (existingLog) {
    const elapsed = Date.now() - new Date(existingLog.last_checked_at).getTime();
    if (elapsed < MIN_RECHECK_INTERVAL_MS) return null;
  }

  const currentVersion = await getThreadVersion(deps.gmail, threadId).catch(() => null);
  const storedVersion = existingLog?.thread_version ?? null;
  const changed = storedVersion === null || storedVersion !== currentVersion;

  if (!changed && existingLog) {
    await deps.supabase
      .from("gmail_thread_reconciliation")
      .update({ last_checked_at: new Date().toISOString(), thread_version: currentVersion })
      .eq("thread_id", threadId);
    return null;
  }

  const raw = await getThread(deps.gmail, threadId);
  const thread = parseThread(raw, deps.userAddresses);
  const entry = await processThread({ supabase: deps.supabase, ...deps.applyDeps }, thread);

  await deps.supabase.from("gmail_thread_reconciliation").upsert({
    thread_id: threadId,
    last_checked_at: new Date().toISOString(),
    thread_version: currentVersion,
    outcome: outcomeForEntry(entry),
    work_item_id: entry.resultingWorkItemId ?? null,
  });

  return entry;
}

export interface ReconciliationExample {
  thread: string;
  threadId: string;
  task: "existing" | "unlinked";
  previousState: string;
  aiInterpretation: string;
  resultingState: string;
  confidence: string | null;
  reason: string | null;
}

export interface ReconciliationSummary {
  // --- Metricas de ESTA corrida, un balde por thread procesado (mutuamente excluyentes) ---
  threadsProcessedThisRun: number;
  autoCreatedThisRun: number;
  autoUpdatedThisRun: number;
  noOpThisRun: number;
  reviewCreatedThisRun: number;
  ignoredThisRun: number;
  /** Descartado por el rule filter ANTES de llamar a la IA (newsletter/bulk) — no cuenta en
   * threadsSuccessfullyClassified ni en las tasas: nunca fue "clasificado". */
  ruleFilteredThisRun: number;
  failedThisRun: number;
  /** autoCreated + autoUpdated + noOp + reviewCreated + ignored — denominador de las tasas.
   * Excluye ruleFiltered (nunca paso por la IA) y failed (la IA no devolvio nada usable). */
  threadsSuccessfullyClassified: number;
  /** (autoCreated + autoUpdated + noOp + ignored) / threadsSuccessfullyClassified, en %.
   * null si threadsSuccessfullyClassified es 0 (nada que dividir). */
  autoHandleRate: number | null;
  /** reviewCreated / threadsSuccessfullyClassified, en %. null si el denominador es 0. */
  reviewRate: number | null;

  // --- Detalle de dominio (AI Work Manager), para el desglose y los ejemplos ---
  existingItemsReconciled: number;
  unlinkedThreadsAnalyzed: number;
  waitingReceived: number;
  followUps: number;
  possiblyResolved: number;
  newActionsDiscovered: number;
  newWaitingDiscovered: number;
  newDelegatedDiscovered: number;
  newCommitmentsDiscovered: number;

  examples: ReconciliationExample[];
}

const MAX_EXAMPLES = 15;

/**
 * AI Work Manager — background reconciliation. Dos tareas: (1) re-examinar Work Items
 * activos linkeados a Gmail cuyo thread cambio desde la ultima vez, (2) descubrir threads
 * recientes de Gmail que todavia no generaron ningun Work Item. Nunca bloquea la UI — corre
 * desde /api/reconcile (cron/encadenado al sync), nunca desde una request del Dashboard.
 */
/** Tope combinado de candidatos por corrida (Existing + Unlinked) — /api/gmail/sync tiene un
 * maxDuration acotado (ver route.ts) y encadena esta funcion al final del sync incremental;
 * un backlog grande se termina de procesar en corridas sucesivas en vez de arriesgar timeout
 * en una sola. */
const DEFAULT_MAX_CANDIDATES = 20;

export async function runReconciliationSweep(
  supabase: DB,
  connection: GoogleConnectionRow,
  days = 7,
  maxCandidates = DEFAULT_MAX_CANDIDATES
): Promise<ReconciliationSummary> {
  const authClient = await getAuthorizedGmailClient(connection);
  const gmail = getGmailApi(authClient);
  const userAddresses = getUserAddresses();
  const aiProvider = getAIProvider();
  const todayISO = todayInTimezone();

  const deps: ReconcileDeps = {
    supabase,
    gmail,
    applyDeps: { aiProvider, todayISO, safeMode: connection.safe_mode },
    userAddresses,
  };

  const summary: ReconciliationSummary = {
    threadsProcessedThisRun: 0,
    autoCreatedThisRun: 0,
    autoUpdatedThisRun: 0,
    noOpThisRun: 0,
    reviewCreatedThisRun: 0,
    ignoredThisRun: 0,
    ruleFilteredThisRun: 0,
    failedThisRun: 0,
    threadsSuccessfullyClassified: 0,
    autoHandleRate: null,
    reviewRate: null,
    existingItemsReconciled: 0,
    unlinkedThreadsAnalyzed: 0,
    waitingReceived: 0,
    followUps: 0,
    possiblyResolved: 0,
    newActionsDiscovered: 0,
    newWaitingDiscovered: 0,
    newDelegatedDiscovered: 0,
    newCommitmentsDiscovered: 0,
    examples: [],
  };

  /** Aplica el resultado de UN thread a las metricas de esta corrida — un solo lugar de
   * verdad para que existing/unlinked queden en los mismos baldes mutuamente excluyentes
   * (ver classifyThreadOutcome). Nunca toca datos historicos (review_item preexistente,
   * ai_action_log de corridas pasadas) — eso queda deliberadamente fuera de este summary. */
  function recordOutcome(entry: ThreadSyncLogEntry): void {
    summary.threadsProcessedThisRun += 1;
    const bucket = classifyThreadOutcome(entry);
    switch (bucket) {
      case "AUTO_CREATED":
        summary.autoCreatedThisRun += 1;
        break;
      case "AUTO_UPDATED":
        summary.autoUpdatedThisRun += 1;
        break;
      case "NO_OP":
        summary.noOpThisRun += 1;
        break;
      case "REVIEW_CREATED":
        summary.reviewCreatedThisRun += 1;
        break;
      case "IGNORED":
        summary.ignoredThisRun += 1;
        break;
      case "RULE_FILTERED":
        summary.ruleFilteredThisRun += 1;
        break;
      case "FAILED":
        summary.failedThisRun += 1;
        break;
    }
    if (entry.action === "RECEIVED_CHECK") summary.waitingReceived += 1;
  }

  let processedCount = 0;

  // --- 1. Existing Item Reconciliation ---
  const candidates = await getReconciliationCandidates(supabase);
  for (const candidate of candidates) {
    if (processedCount >= maxCandidates) break;
    let result: { checked: boolean; entry: ThreadSyncLogEntry | null };
    try {
      result = await reconcileCandidate(deps, candidate);
    } catch (err) {
      console.error(`[reconcile] existing item ${candidate.workItemId} / thread ${candidate.threadId} fallo:`, err);
      continue;
    }
    if (!result.checked) continue;
    processedCount += 1;
    summary.existingItemsReconciled += 1;
    const e = result.entry;
    if (!e) continue; // fingerprint sin cambios — ya se conto en reconcileCandidate, no gasto IA, no es un thread "procesado" para las metricas de este run

    recordOutcome(e);

    if (summary.examples.length < MAX_EXAMPLES) {
      summary.examples.push({
        thread: e.subject,
        threadId: e.threadId,
        task: "existing",
        previousState: `Work Item existente (${candidate.workItemId})`,
        aiInterpretation: `${e.classification ?? "-"} / relevance=${e.relevance ?? "-"}`,
        resultingState: e.action,
        confidence: e.confidence,
        reason: e.rationale ?? null,
      });
    }
  }

  // --- 2. Unlinked Thread Discovery ---
  const unlinkedThreadIds = await getUnlinkedThreadCandidates(gmail, supabase, days);
  for (const threadId of unlinkedThreadIds) {
    if (processedCount >= maxCandidates) break;
    let entry: ThreadSyncLogEntry | null;
    try {
      entry = await discoverThread(deps, threadId);
    } catch (err) {
      console.error(`[reconcile] unlinked thread ${threadId} fallo:`, err);
      continue;
    }
    if (!entry) continue; // salteado: chequeado hace poco, o sin cambios desde la ultima vez
    processedCount += 1;

    recordOutcome(entry);
    if (entry.llmCalled) summary.unlinkedThreadsAnalyzed += 1;

    const isCreateLike = entry.action === "AUTO_CREATE" || entry.action.startsWith("REVIEW_NEW") || entry.action.startsWith("WOULD_CREATE");
    if (isCreateLike) {
      if (entry.isDelegation) summary.newDelegatedDiscovered += 1;
      else if (entry.classification === "ACTION") summary.newActionsDiscovered += 1;
      else if (entry.classification === "WAITING") summary.newWaitingDiscovered += 1;
      else if (entry.classification === "COMMITMENT") summary.newCommitmentsDiscovered += 1;
    }

    if (summary.examples.length < MAX_EXAMPLES) {
      summary.examples.push({
        thread: entry.subject,
        threadId: entry.threadId,
        task: "unlinked",
        previousState: "no existia ningun Work Item",
        aiInterpretation: `${entry.classification ?? "-"} / relevance=${entry.relevance ?? "-"}`,
        resultingState: entry.action,
        confidence: entry.confidence,
        reason: entry.rationale ?? null,
      });
    }
  }

  summary.threadsSuccessfullyClassified =
    summary.autoCreatedThisRun + summary.autoUpdatedThisRun + summary.noOpThisRun + summary.reviewCreatedThisRun + summary.ignoredThisRun;
  if (summary.threadsSuccessfullyClassified > 0) {
    const autoHandled = summary.autoCreatedThisRun + summary.autoUpdatedThisRun + summary.noOpThisRun + summary.ignoredThisRun;
    summary.autoHandleRate = Math.round((autoHandled / summary.threadsSuccessfullyClassified) * 1000) / 10;
    summary.reviewRate = Math.round((summary.reviewCreatedThisRun / summary.threadsSuccessfullyClassified) * 1000) / 10;
  }

  await updateLastReconciliationSummary(supabase, connection.id, summary as unknown as Record<string, unknown>);

  return summary;
}
