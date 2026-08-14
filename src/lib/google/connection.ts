import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleConnectionRow } from "@/lib/supabase/types";
import { encryptToken } from "./tokenCrypto";

/**
 * V1 asume una unica conexion de Gmail para todo el workspace (ver comentario en
 * supabase/schema_gmail.sql). Tipado como SupabaseClient generico (sin parametrizar por
 * Database — ver la nota en src/lib/supabase/server.ts) para que estas funciones acepten
 * tanto el service client (sync en background) como el cliente de sesion normal (callback
 * de OAuth, que corre con un usuario autenticado) sin castear nada en el call site.
 *
 * IMPORTANTE sobre cifrado: access_token/refresh_token se guardan SIEMPRE cifrados (ver
 * tokenCrypto.ts) — este modulo nunca los desencripta. Solo
 * src/lib/google/oauthClient.ts los desencripta, justo antes de usarlos para llamar a la
 * API de Gmail, y vuelve a cifrar antes de persistir un token refrescado.
 */
type DB = SupabaseClient;

export async function getActiveConnection(supabase: DB): Promise<GoogleConnectionRow | null> {
  const { data, error } = await supabase
    .from("google_connection")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as GoogleConnectionRow | null) ?? null;
}

export async function saveConnection(
  supabase: DB,
  params: { email: string; accessToken: string; refreshToken: string; expiresAt: string; scope: string }
): Promise<GoogleConnectionRow> {
  const existing = await getActiveConnection(supabase);

  const fields = {
    email: params.email,
    access_token: encryptToken(params.accessToken),
    refresh_token: encryptToken(params.refreshToken),
    token_expires_at: params.expiresAt,
    scope: params.scope,
    // Una conexion (re)establecida exitosamente siempre limpia cualquier estado previo
    // de "necesita reconexion" — es exactamente lo que este flujo acaba de resolver.
    needs_reconnect: false,
    last_error: null,
  };

  if (existing) {
    const { data, error } = await supabase.from("google_connection").update(fields).eq("id", existing.id).select().single();
    if (error) throw error;
    return data as GoogleConnectionRow;
  }

  const { data, error } = await supabase.from("google_connection").insert(fields).select().single();
  if (error) throw error;
  return data as GoogleConnectionRow;
}

export async function updateSyncCursor(supabase: DB, connectionId: string, historyId: string | null): Promise<void> {
  const { error } = await supabase
    .from("google_connection")
    .update({ history_id: historyId, last_synced_at: new Date().toISOString() })
    .eq("id", connectionId);
  if (error) throw error;
}

/** Cursor del sync incremental de Case — separado de updateSyncCursor (Work Item) a proposito,
 * ver nota en schema_case_sync.sql. */
export async function updateCaseSyncCursor(supabase: DB, connectionId: string, caseHistoryId: string | null): Promise<void> {
  const { error } = await supabase
    .from("google_connection")
    .update({ case_history_id: caseHistoryId, last_case_synced_at: new Date().toISOString() })
    .eq("id", connectionId);
  if (error) throw error;
}

export async function updateLastCaseSyncSummary(supabase: DB, connectionId: string, summary: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("google_connection")
    .update({ last_case_sync_summary: summary, last_case_synced_at: new Date().toISOString() })
    .eq("id", connectionId);
  if (error) throw error;
}

export async function markBootstrapCompleted(
  supabase: DB,
  connectionId: string,
  rangeDays: number,
  summary: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("google_connection")
    .update({
      bootstrap_completed_at: new Date().toISOString(),
      bootstrap_range_days: rangeDays,
      last_sync_summary: summary,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", connectionId);
  if (error) throw error;
}

export async function updateLastSyncSummary(supabase: DB, connectionId: string, summary: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("google_connection")
    .update({ last_sync_summary: summary, last_synced_at: new Date().toISOString() })
    .eq("id", connectionId);
  if (error) throw error;
}

/** Ultimo resultado de runReconciliationSweep (AI Work Manager) — el Dashboard lo lee para
 * el Morning Brief sin llamar a la IA en el render, mismo patron que last_sync_summary. */
export async function updateLastReconciliationSummary(supabase: DB, connectionId: string, summary: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("google_connection")
    .update({ last_reconciliation_summary: summary, last_reconciled_at: new Date().toISOString() })
    .eq("id", connectionId);
  if (error) throw error;
}

/** El refresh_token dejo de ser valido (revocado, o el usuario cambio la password, etc).
 * `errorMessage` es SOLO para diagnostico humano — nunca debe incluir el token en si. */
export async function markNeedsReconnect(supabase: DB, connectionId: string, errorMessage: string): Promise<void> {
  const { error } = await supabase
    .from("google_connection")
    .update({ needs_reconnect: true, last_error: errorMessage })
    .eq("id", connectionId);
  if (error) throw error;
}
