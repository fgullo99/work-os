import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { purgeDemoData } from "@/lib/admin/purgeDemo";

/** Requiere sesion (el middleware ya lo exige para cualquier /api que no este en la
 * lista publica) — no hace falta un chequeo de rol adicional en V1 (workspace de una sola
 * persona, ver supabase/schema.sql). */
export async function POST() {
  const supabase = createSupabaseServerClient();
  try {
    const result = await purgeDemoData(supabase);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[purge-demo]", err);
    return NextResponse.json({ ok: false, error: "purge_failed" }, { status: 500 });
  }
}
