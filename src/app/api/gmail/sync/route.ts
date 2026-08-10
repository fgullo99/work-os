import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getConnectionOrThrow, runIncrementalSync } from "@/lib/gmail/sync";

/**
 * Dual-auth a proposito: esta ruta la puede llamar (a) un cron externo, que no tiene
 * cookies de sesion (autentica con CRON_SECRET), o (b) el boton "Sync now" de Settings,
 * que si tiene sesion normal. src/middleware.ts exime esta ruta puntual del gate de sesion
 * generico — el chequeo de autorizacion pasa a vivir aca adentro.
 */
export async function POST(request: Request) {
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
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[gmail sync]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "sync_failed" }, { status: 500 });
  }
}
