import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getConnectionOrThrow, runIncrementalSync } from "@/lib/gmail/sync";
import { runReconciliationSweep, type ReconciliationSummary } from "@/lib/gmail/reconcile";

// Tope maximo permitido por Vercel para este endpoint. El sync procesa threads en
// serie con una llamada real a Anthropic por thread, asi que puede tardar mas que el
// limite default de la funcion serverless (10s) — sobre todo la primera vez que hay
// un backlog grande pendiente de procesar.
export const maxDuration = 60;

/**
 * Dual-auth a proposito: esta ruta la puede llamar (a) un cron externo, que no tiene
 * cookies de sesion (autentica con CRON_SECRET), o (b) el boton "Sync now" de Settings,
 * que si tiene sesion normal. src/middleware.ts exime esta ruta puntual del gate de sesion
 * generico — el chequeo de autorizacion pasa a vivir aca adentro.
 */
async function handler(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const hasValidCronAuth = Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;

  if (!hasValidCronAuth) {
    const sessionSupabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await sessionSupabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  // El sync en si siempre corre con el service client: puede disparerse sin sesion de
  // usuario (cron), y de todas formas es un proceso de sistema, no una accion "de alguien".
  const supabase = createSupabaseServiceClient();
  try {
    const connection = await getConnectionOrThrow(supabase);
    const summary = await runIncrementalSync(supabase, connection);

    // AI Work Manager, encadenado despues de cada sync relevante — nunca bloquea la
    // respuesta del sync si falla (un problema en la reconciliacion no debe tumbar el sync
    // normal, que ya corrio y persistio bien). Tope de candidatos acotado (ver reconcile.ts)
    // para no arriesgar el mismo timeout que ya tuvimos en este endpoint.
    let reconciliation: ReconciliationSummary | null = null;
    try {
      reconciliation = await runReconciliationSweep(supabase, connection);
    } catch (err) {
      console.error("[gmail sync] reconciliation fallo (el sync ya se aplico bien):", err);
    }

    return NextResponse.json({ ok: true, summary, reconciliation });
  } catch (err) {
    console.error("[gmail sync]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "sync_failed" }, { status: 500 });
  }
}

// Vercel Cron Jobs disparan con GET (no POST) y agregan automaticamente
// "Authorization: Bearer $CRON_SECRET" cuando ese env var existe en el proyecto — mismo
// handler, misma auth interna, no hace falta duplicar nada.
export const POST = handler;
export const GET = handler;
