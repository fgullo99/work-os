import type { SupabaseClient } from "@supabase/supabase-js";
import type { gmail_v1 } from "googleapis";
import { getAuthorizedGmailClient } from "@/lib/google/oauthClient";
import { getActiveConnection, markBootstrapCompleted, updateLastSyncSummary, updateSyncCursor } from "@/lib/google/connection";
import {
  HistoryExpiredError,
  getCurrentHistoryId,
  getGmailApi,
  getThread,
  listChangedThreadIdsSinceHistory,
  listThreadIdsSinceDays,
} from "./client";
import { parseThread } from "./threadParser";
import { processThread, type ThreadSyncLogEntry } from "./applySync";
import { getAIProvider } from "@/lib/ai";
import { todayInTimezone } from "@/lib/dates/timezone";
import type { GoogleConnectionRow } from "@/lib/supabase/types";

export interface SyncSummary {
  threadsAnalyzed: number;
  highItems: number;
  reviewItems: number;
  ignored: number;
  errors: number;
  autoCreated: number;
  autoUpdated: number;
  personalFiltered: number;
  /** Motivo de rule-filter -> cantidad (ver ruleFilter.ts). Ej: {"List-Unsubscribe...": 14}. */
  filteredByReason: Record<string, number>;
  log: ThreadSyncLogEntry[];
}

export function getUserAddresses(): string[] {
  const raw = process.env.USER_EMAIL_ADDRESSES ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function processThreadIds(
  supabase: SupabaseClient,
  gmail: gmail_v1.Gmail,
  threadIds: string[],
  safeMode: boolean
): Promise<ThreadSyncLogEntry[]> {
  const userAddresses = getUserAddresses();
  const aiProvider = getAIProvider();
  const todayISO = todayInTimezone();
  const entries: ThreadSyncLogEntry[] = [];

  for (const threadId of threadIds) {
    try {
      const raw = await getThread(gmail, threadId);
      const thread = parseThread(raw, userAddresses);
      const entry = await processThread({ supabase, aiProvider, todayISO, safeMode }, thread);
      entries.push(entry);
      // Observabilidad minima: nunca loguear cuerpos de email completos ni tokens/keys,
      // solo metadata de decision (ver seccion 21 del spec de Etapa 2).
      console.log(
        `[gmail sync] thread=${threadId} ruleFilterSkipped=${entry.ruleFilterSkipped} llmCalled=${entry.llmCalled} classification=${entry.classification ?? "-"} confidence=${entry.confidence ?? "-"} action=${entry.action}`
      );
    } catch (err) {
      console.error(`[gmail sync] error procesando thread ${threadId}:`, err instanceof Error ? err.message : err);
      entries.push({
        threadId,
        subject: "(error)",
        ruleFilterSkipped: false,
        ruleFilterReason: null,
        llmCalled: false,
        relevance: null,
        classification: null,
        confidence: null,
        isDelegation: null,
        action: "ERROR",
      });
    }
  }

  return entries;
}

function summarize(entries: ThreadSyncLogEntry[]): Omit<SyncSummary, "log"> {
  let highItems = 0;
  let reviewItems = 0;
  let ignored = 0;
  let errors = 0;
  let autoCreated = 0;
  let autoUpdated = 0;
  let personalFiltered = 0;
  const filteredByReason: Record<string, number> = {};

  for (const e of entries) {
    if (e.ruleFilterReason) {
      filteredByReason[e.ruleFilterReason] = (filteredByReason[e.ruleFilterReason] ?? 0) + 1;
    }
    if (e.relevance === "PERSONAL") personalFiltered += 1;

    if (e.action === "ERROR") errors += 1;
    else if (e.action === "AUTO_CREATE") {
      autoCreated += 1;
      highItems += 1;
    } else if (e.action === "AUTO_UPDATE") {
      autoUpdated += 1;
      highItems += 1;
    } else if (e.action.startsWith("WOULD_")) highItems += 1;
    else if (e.action.startsWith("REVIEW") || e.action === "RECEIVED_CHECK") reviewItems += 1;
    else ignored += 1;
  }
  return { threadsAnalyzed: entries.length, highItems, reviewItems, ignored, errors, autoCreated, autoUpdated, personalFiltered, filteredByReason };
}

export interface ImportPreview {
  threadsFound: number;
  ruleFiltered: number;
  analyzedByAI: number;
  actions: number;
  waiting: number;
  commitments: number;
  info: number;
  ignored: number;
  highConfidence: number;
  review: number;
  possibleDuplicates: number;
  personal: number;
  autoCreated: number;
  autoUpdated: number;
}

/** Desglose para la pantalla "GMAIL IMPORT PREVIEW" que se muestra despues de un bootstrap
 * (nunca entra nada al Dashboard en silencio — ver seccion 4 del spec de V1). */
export function buildImportPreview(entries: ThreadSyncLogEntry[]): ImportPreview {
  const preview: ImportPreview = {
    threadsFound: entries.length,
    ruleFiltered: 0,
    analyzedByAI: 0,
    actions: 0,
    waiting: 0,
    commitments: 0,
    info: 0,
    ignored: 0,
    highConfidence: 0,
    review: 0,
    possibleDuplicates: 0,
    personal: 0,
    autoCreated: 0,
    autoUpdated: 0,
  };

  for (const e of entries) {
    if (e.ruleFilterSkipped) preview.ruleFiltered += 1;
    if (e.llmCalled) preview.analyzedByAI += 1;
    if (e.confidence === "HIGH") preview.highConfidence += 1;
    if (e.relevance === "PERSONAL") preview.personal += 1;
    if (e.action === "REVIEW_POSSIBLE_DUPLICATE") preview.possibleDuplicates += 1;
    if (e.action === "AUTO_CREATE") preview.autoCreated += 1;
    if (e.action === "AUTO_UPDATE") preview.autoUpdated += 1;
    if (e.action.startsWith("REVIEW") || e.action.startsWith("WOULD_") || e.action === "RECEIVED_CHECK") {
      preview.review += 1;
    }

    switch (e.classification) {
      case "ACTION":
        preview.actions += 1;
        break;
      case "WAITING":
        preview.waiting += 1;
        break;
      case "COMMITMENT":
        preview.commitments += 1;
        break;
      case "INFO":
        preview.info += 1;
        break;
      case "IGNORE":
        preview.ignored += 1;
        break;
      default:
        if (e.ruleFilterSkipped) preview.ignored += 1;
    }
  }

  return preview;
}

/**
 * Primera sincronizacion, acotada a un rango de dias elegido por el usuario (secciones 4 y
 * 20 del spec: nunca procesar años de correo silenciosamente). Deja el cursor (historyId)
 * listo para que el sync incremental arranque desde ahi.
 */
export async function runBootstrapSync(
  supabase: SupabaseClient,
  connection: GoogleConnectionRow,
  days: 7 | 14 | 30 | 60 | 90
): Promise<{ summary: SyncSummary; preview: ImportPreview }> {
  const authClient = await getAuthorizedGmailClient(connection);
  const gmail = getGmailApi(authClient);

  const threadIds = await listThreadIdsSinceDays(gmail, days);
  const entries = await processThreadIds(supabase, gmail, threadIds, connection.safe_mode);
  const summary: SyncSummary = { ...summarize(entries), log: entries };
  const preview = buildImportPreview(entries);

  const currentHistoryId = await getCurrentHistoryId(gmail);
  await markBootstrapCompleted(supabase, connection.id, days, summary as unknown as Record<string, unknown>);
  await updateSyncCursor(supabase, connection.id, currentHistoryId);

  return { summary, preview };
}

/**
 * Sync incremental: usa el cursor (historyId) para traer solo threads con actividad nueva
 * — nunca vuelve a descargar toda la casilla (seccion 3 del spec). Preparado para poder
 * cambiarse a push (webhook/Pub-Sub) mas adelante sin tocar processThread/applySync: ese
 * pipeline no sabe ni le importa si lo dispara un poll o un webhook.
 */
export async function runIncrementalSync(supabase: SupabaseClient, connection: GoogleConnectionRow): Promise<SyncSummary> {
  const authClient = await getAuthorizedGmailClient(connection);
  const gmail = getGmailApi(authClient);

  if (!connection.history_id) {
    return runFallbackShortSync(supabase, connection, gmail);
  }

  try {
    const { threadIds, newHistoryId } = await listChangedThreadIdsSinceHistory(gmail, connection.history_id);
    const entries = await processThreadIds(supabase, gmail, threadIds, connection.safe_mode);
    const summary: SyncSummary = { ...summarize(entries), log: entries };
    await updateSyncCursor(supabase, connection.id, newHistoryId ?? connection.history_id);
    await updateLastSyncSummary(supabase, connection.id, summary as unknown as Record<string, unknown>);
    return summary;
  } catch (err) {
    if (err instanceof HistoryExpiredError) {
      return runFallbackShortSync(supabase, connection, gmail);
    }
    throw err;
  }
}

/** Cursor ausente o vencido: re-sincroniza una ventana corta (2 dias) en vez de fallar o
 * re-procesar todo desde cero. */
async function runFallbackShortSync(supabase: SupabaseClient, connection: GoogleConnectionRow, gmail: gmail_v1.Gmail): Promise<SyncSummary> {
  const threadIds = await listThreadIdsSinceDays(gmail, 2);
  const entries = await processThreadIds(supabase, gmail, threadIds, connection.safe_mode);
  const summary: SyncSummary = { ...summarize(entries), log: entries };
  const currentHistoryId = await getCurrentHistoryId(gmail);
  await updateSyncCursor(supabase, connection.id, currentHistoryId);
  await updateLastSyncSummary(supabase, connection.id, summary as unknown as Record<string, unknown>);
  return summary;
}

export async function getConnectionOrThrow(supabase: SupabaseClient): Promise<GoogleConnectionRow> {
  const connection = await getActiveConnection(supabase);
  if (!connection) throw new Error("No hay ninguna cuenta de Gmail conectada todavia.");
  return connection;
}
