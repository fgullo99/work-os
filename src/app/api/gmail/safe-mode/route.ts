import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveConnection } from "@/lib/google/connection";

/** Toggle de Safe Mode (ver src/lib/gmail/applySync.ts). Requiere que ya exista una
 * conexion — no tiene sentido tocar el flag antes de conectar Gmail. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const enabled = body?.enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "enabled debe ser boolean" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  try {
    const connection = await getActiveConnection(supabase);
    if (!connection) {
      return NextResponse.json({ ok: false, error: "no_connection" }, { status: 400 });
    }
    const { error } = await supabase.from("google_connection").update({ safe_mode: enabled }).eq("id", connection.id);
    if (error) throw error;
    return NextResponse.json({ ok: true, safeMode: enabled });
  } catch (err) {
    console.error("[gmail safe-mode]", err);
    return NextResponse.json({ ok: false, error: "safe_mode_update_failed" }, { status: 500 });
  }
}
