import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveConnection } from "@/lib/google/connection";

/** Desconectar Gmail: borra la conexion (tokens cifrados incluidos). No revoca el permiso
 * del lado de Google — eso el usuario lo hace, si quiere, en myaccount.google.com/permissions.
 * Volver a conectar simplemente crea una conexion nueva. */
export async function POST() {
  const supabase = createSupabaseServerClient();
  try {
    const connection = await getActiveConnection(supabase);
    if (!connection) {
      return NextResponse.json({ ok: true, alreadyDisconnected: true });
    }
    const { error } = await supabase.from("google_connection").delete().eq("id", connection.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[gmail disconnect]", err);
    return NextResponse.json({ ok: false, error: "disconnect_failed" }, { status: 500 });
  }
}
