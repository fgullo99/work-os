import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getConnectionOrThrow, runIncrementalSync } from "@/lib/gmail/sync";
import { runReconciliationSweep, type ReconciliationSummary } from "@/lib/gmail/reconcile";

// Tope maximo permitido por Vercel para este endpoint. El sync procesa threads en
// serie con una llamada real a Anthropic por thread, asi que puede tardar mas que el
// limite default de la funcion serverless (10s) — sobre todo la primera vez que hay
// un backlog grande pendiente de procesar.
//
// A PROPOSITO no se encadena el sync incremental de Case aca (ver caseSync.ts): ya se probo
// y causo FUNCTION_INVOCATION_TIMEOUT (504) en produccion — sumar un tercer paso secuencial
// (Work Item + reconciliacion + Case, cada uno con su propia llamada real a Anthropic por
// thread) supera el limite de 60s. El sync de Case vive en su propia ruta
// (/api/cases/sync) con su propio presupuesto de tiempo y su propio cron, corriendo
// independiente de este.
export const maxDuration = 60;

// Flag reversible (item pedido: "no eliminar codigo, hacerlo reversible con un flag") — el
// pipeline de Work Item quedo demoted a legacy desde que el Dashboard/Kanban corre sobre
// Case, y correr los dos duplica el costo de IA analizando el mismo email dos veces (ver
// cotizacion de costo pedida por Felipe). Default OFF a proposito (sin depender de que
// alguien configure una env var nueva en Vercel para desactivarlo) — para reactivarlo, seteá
// WORK_ITEM_GMAIL_SYNC_ENABLED=true en las env vars del proyecto en Vercel. La infraestructura
// comun de Gmail (OAuth/refresh, cliente, cursor, fetch de threads) no se toca — el pipeline
// de Case (src/lib/cases/caseSync.ts, ruta /api/cases/sync) la usa de forma completamente
// independiente y sigue activo sin importar este flag.
const WORK_ITEM_SYNC_ENABLED = process.env.WORK_ITEM_GMAIL_SYNC_ENABLED === "true";

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

  if (!WORK_ITEM_SYNC_ENABLED) {
    return NextResponse.json({
      ok: false,
      error: "Sync legacy de Work Item desactivado — Case (ver Settings > Case Catch-up) es el pipeline activo. Reactivar con WORK_ITEM_GMAIL_SYNC_ENABLED=true.",
      disabled: true,
    });
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
