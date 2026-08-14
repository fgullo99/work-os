import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getConnectionOrThrow } from "@/lib/gmail/sync";
import { runIncrementalCaseSync } from "@/lib/cases/caseSync";

// Ruta separada de /api/gmail/sync a proposito (ver nota ahi): encadenar los dos sync en la
// misma request ya causo un 504 en produccion (Work Item + reconciliacion + Case supera el
// limite de 60s). Cursor independiente (case_history_id), asi que puede correr en cualquier
// momento relativo al otro sync sin pisarlo.
export const maxDuration = 60;

/** Mismo dual-auth que /api/gmail/sync — ver el comentario ahi, mismo criterio. */
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

  const supabase = createSupabaseServiceClient();
  try {
    const connection = await getConnectionOrThrow(supabase);
    const summary = await runIncrementalCaseSync(supabase, connection);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[case sync]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "sync_failed" }, { status: 500 });
  }
}

export const POST = handler;
export const GET = handler;
