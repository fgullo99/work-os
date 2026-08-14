import type { SupabaseClient } from "@supabase/supabase-js";
import type { gmail_v1 } from "googleapis";
import { getAuthorizedGmailClient } from "@/lib/google/oauthClient";
import {
  HistoryExpiredError,
  getCurrentHistoryId,
  getGmailApi,
  getThread,
  listChangedThreadIdsSinceHistory,
  listThreadIdsSinceDays,
} from "@/lib/gmail/client";
import { parseThread } from "@/lib/gmail/threadParser";
import { getUserAddresses } from "@/lib/gmail/sync";
import { updateCaseSyncCursor, updateLastCaseSyncSummary } from "@/lib/google/connection";
import { getAIProvider, type AiUsage } from "@/lib/ai";
import { todayInTimezone } from "@/lib/dates/timezone";
import type { GoogleConnectionRow } from "@/lib/supabase/types";
import { processThreadForCase, type CaseSyncLogEntry } from "./caseAnalysis";
import { getInternalTeamMembers } from "./teamMembers";

type DB = SupabaseClient;

export interface CaseSyncSummary {
  threadsProcessed: number;
  casesCreated: number;
  threadsMerged: number;
  caseMergeReview: number;
  caseStateReview: number;
  errors: number;
  ruleFiltered: number;
  aiUsage: { calls: number; inputTokens: number; outputTokens: number };
  log: CaseSyncLogEntry[];
}

async function processThreadIds(supabase: DB, gmail: gmail_v1.Gmail, threadIds: string[], safeMode: boolean): Promise<CaseSyncSummary> {
  const userAddresses = getUserAddresses();
  const internalTeamMembers = getInternalTeamMembers();
  const aiProvider = getAIProvider();
  const todayISO = todayInTimezone();
  const aiUsage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const onAiUsage = (usage: AiUsage) => {
    aiUsage.calls += 1;
    aiUsage.inputTokens += usage.inputTokens;
    aiUsage.outputTokens += usage.outputTokens;
  };

  const log: CaseSyncLogEntry[] = [];
  let errors = 0;

  for (const threadId of threadIds) {
    try {
      const raw = await getThread(gmail, threadId);
      const thread = parseThread(raw, userAddresses);
      const entry = await processThreadForCase(
        { supabase, aiProvider, todayISO, safeMode, userAddresses, internalTeamMembers, onAiUsage },
        thread
      );
      log.push(entry);
      console.log(
        `[case sync] thread=${threadId} ruleFilterSkipped=${entry.ruleFilterSkipped} matchTier=${entry.matchTier ?? "-"} action=${entry.action}`
      );
    } catch (err) {
      console.error(`[case sync] error procesando thread ${threadId}:`, err instanceof Error ? err.message : err);
      errors += 1;
    }
  }

  let casesCreated = 0;
  let threadsMerged = 0;
  let caseMergeReview = 0;
  let caseStateReview = 0;
  let ruleFiltered = 0;
  for (const e of log) {
    if (e.ruleFilterSkipped) ruleFiltered += 1;
    else if (e.action === "AUTO_CREATE_CASE") casesCreated += 1;
    else if (e.action === "AUTO_MERGE") threadsMerged += 1;
    else if (e.action === "CASE_MERGE_REVIEW") caseMergeReview += 1;
    else if (e.action === "CASE_STATE_REVIEW") caseStateReview += 1;
  }

  return { threadsProcessed: threadIds.length, casesCreated, threadsMerged, caseMergeReview, caseStateReview, errors, ruleFiltered, aiUsage, log };
}

function emptySummary(): CaseSyncSummary {
  return {
    threadsProcessed: 0,
    casesCreated: 0,
    threadsMerged: 0,
    caseMergeReview: 0,
    caseStateReview: 0,
    errors: 0,
    ruleFiltered: 0,
    aiUsage: { calls: 0, inputTokens: 0, outputTokens: 0 },
    log: [],
  };
}

/**
 * Sync incremental de Case (item 42 del pedido): mismo patron que runIncrementalSync (Work
 * Item, ver gmail/sync.ts), pero con su propio cursor (case_history_id, nunca comparte
 * history_id con el pipeline viejo — ver schema_case_sync.sql) y llamando
 * processThreadForCase() en vez de processThread(). Corre en su propia ruta
 * (/api/cases/sync), su propio cron, encadenado con nada mas.
 *
 * A PROPOSITO nunca escanea retroactivamente cuando el cursor esta ausente o vencido — ya se
 * probo en produccion y una ventana de 2 dias con el volumen real de TMC (15-30+ threads,
 * cada uno con una llamada real a Anthropic) supera largo los 60s de Vercel, sin importar que
 * corra sola en su propia ruta. En ese caso, esta funcion SOLO fija el cursor a "ahora" y
 * arranca a trackear desde ahi — el gap de threads recientes se cierra UNA vez, manualmente,
 * corriendo bootstrapFallbackCaseSync() localmente (sin el limite de tiempo de Vercel), ver
 * scripts/run-case-sample.ts para el mismo patron ya usado en el catch-up historico.
 */
export async function runIncrementalCaseSync(supabase: DB, connection: GoogleConnectionRow): Promise<CaseSyncSummary> {
  const authClient = await getAuthorizedGmailClient(connection);
  const gmail = getGmailApi(authClient);

  if (!connection.case_history_id) {
    const currentHistoryId = await getCurrentHistoryId(gmail);
    await updateCaseSyncCursor(supabase, connection.id, currentHistoryId);
    return emptySummary();
  }

  try {
    const { threadIds, newHistoryId } = await listChangedThreadIdsSinceHistory(gmail, connection.case_history_id);
    const summary = await processThreadIds(supabase, gmail, threadIds, connection.safe_mode);
    await updateCaseSyncCursor(supabase, connection.id, newHistoryId ?? connection.case_history_id);
    await updateLastCaseSyncSummary(supabase, connection.id, summary as unknown as Record<string, unknown>);
    return summary;
  } catch (err) {
    if (err instanceof HistoryExpiredError) {
      const currentHistoryId = await getCurrentHistoryId(gmail);
      await updateCaseSyncCursor(supabase, connection.id, currentHistoryId);
      return emptySummary();
    }
    throw err;
  }
}

/**
 * Bootstrap manual, para correr UNA vez localmente (npx tsx, sin el limite de 60s de Vercel)
 * despues de activar el sync incremental: cierra la brecha de threads recientes (por default
 * los ultimos `days` dias) que el cron nunca va a escanear retroactivamente por diseño (ver
 * runIncrementalCaseSync). Deja el cursor listo para que el cron siga solo desde ahi.
 */
export async function bootstrapFallbackCaseSync(supabase: DB, connection: GoogleConnectionRow, days = 2): Promise<CaseSyncSummary> {
  const authClient = await getAuthorizedGmailClient(connection);
  const gmail = getGmailApi(authClient);
  const threadIds = await listThreadIdsSinceDays(gmail, days);
  const summary = await processThreadIds(supabase, gmail, threadIds, connection.safe_mode);
  const currentHistoryId = await getCurrentHistoryId(gmail);
  await updateCaseSyncCursor(supabase, connection.id, currentHistoryId);
  await updateLastCaseSyncSummary(supabase, connection.id, summary as unknown as Record<string, unknown>);
  return summary;
}
