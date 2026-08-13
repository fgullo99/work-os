import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getActiveConnection } from "@/lib/google/connection";
import { getConnectionOrThrow } from "@/lib/gmail/sync";
import { getCaseCatchupState, runCaseCatchupBatch, CatchupLockError } from "@/lib/cases/caseCatchup";

// Mismo motivo que /api/gmail/catchup: un lote real puede acercarse al limite default de 10s.
export const maxDuration = 60;

/** Solo lectura: estado actual del catch-up de Cases para el panel de Settings. Nunca
 * dispara trabajo — eso es POST. */
export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const connection = await getActiveConnection(supabase);
    if (!connection) return NextResponse.json({ ok: true, state: null });
    const state = await getCaseCatchupState(supabase, connection.id);
    return NextResponse.json({ ok: true, state });
  } catch (err) {
    console.error("[case catchup status]", err);
    return NextResponse.json({ ok: false, error: "status_failed" }, { status: 500 });
  }
}

/** Boton "Run catch-up" del panel de Cases en Settings: procesa UN lote acotado y devuelve
 * el estado actualizado. Idempotente y resumible — ver src/lib/cases/caseCatchup.ts. */
export async function POST() {
  const sessionSupabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const supabase = createSupabaseServiceClient();
  try {
    const connection = await getConnectionOrThrow(supabase);
    const result = await runCaseCatchupBatch(supabase, connection);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    if (err instanceof CatchupLockError) {
      return NextResponse.json({ ok: false, error: "CATCHUP_ALREADY_RUNNING" }, { status: 409 });
    }
    console.error("[case catchup run]", err);
    return NextResponse.json({ ok: false, error: "catchup_failed" }, { status: 500 });
  }
}
