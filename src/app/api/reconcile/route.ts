import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getConnectionOrThrow } from "@/lib/gmail/sync";
import { runReconciliationSweep } from "@/lib/gmail/reconcile";

export const maxDuration = 60;

/**
 * AI Work Manager bajo demanda — mismo self-auth que /api/gmail/sync (CRON_SECRET o
 * sesion). Se usa para la corrida de la "tarde" ademas de la que ya va encadenada al sync
 * de la mañana — Vercel Hobby limita los cron nativos a 1 vez/dia por entrada, asi que la
 * segunda corrida diaria hay que dispararla externamente contra este endpoint (o revisar el
 * plan de Vercel) en vez de asumir un segundo cron nativo.
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

  const supabase = createSupabaseServiceClient();
  try {
    const connection = await getConnectionOrThrow(supabase);
    const reconciliation = await runReconciliationSweep(supabase, connection);
    return NextResponse.json({ ok: true, reconciliation });
  } catch (err) {
    console.error("[reconcile]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "reconcile_failed" }, { status: 500 });
  }
}

export const POST = handler;
export const GET = handler;
