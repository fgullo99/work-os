import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getActiveConnection } from "@/lib/google/connection";
import { getConnectionOrThrow } from "@/lib/gmail/sync";
import { getCatchupState, runCatchupBatch } from "@/lib/gmail/catchup";

// Un lote real (25 threads, ~45s de presupuesto) puede acercarse al limite default de 10s —
// mismo motivo que /api/gmail/sync.
export const maxDuration = 60;

/** Solo lectura: estado actual del catch-up (Pending/Processed/Review/Failed) para el panel
 * de Settings. Nunca dispara trabajo — eso es POST. */
export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const connection = await getActiveConnection(supabase);
    if (!connection) return NextResponse.json({ ok: true, state: null });
    const state = await getCatchupState(supabase, connection.id);
    return NextResponse.json({ ok: true, state });
  } catch (err) {
    console.error("[gmail catchup status]", err);
    return NextResponse.json({ ok: false, error: "status_failed" }, { status: 500 });
  }
}

/** Boton "Continue catch-up" de Settings: procesa UN lote acotado (25 threads / 45s) y
 * devuelve el estado actualizado. Idempotente y resumible — ver src/lib/gmail/catchup.ts. */
export async function POST() {
  const sessionSupabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const supabase = createSupabaseServiceClient();
  try {
    const connection = await getConnectionOrThrow(supabase);
    const result = await runCatchupBatch(supabase, connection);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[gmail catchup run]", err);
    return NextResponse.json({ ok: false, error: "catchup_failed" }, { status: 500 });
  }
}
