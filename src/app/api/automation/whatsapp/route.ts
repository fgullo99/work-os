import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAutomationSettings, setWhatsappAutoEnabled } from "@/lib/engine/automationSettings";

/** Toggle de AI Automation para WhatsApp (automation_settings.whatsapp_auto_enabled, arranca
 * en false — ver src/lib/whatsapp/zapiaDecision.ts). Gmail NO tiene equivalente aca a
 * proposito: usa google_connection.safe_mode como unica fuente de verdad (ver
 * /api/gmail/safe-mode), para no tener dos booleanos que puedan desincronizarse. */
export async function GET() {
  const supabase = createSupabaseServerClient();
  try {
    const settings = await getAutomationSettings(supabase);
    return NextResponse.json({ ok: true, whatsappAutoEnabled: settings.whatsapp_auto_enabled });
  } catch (err) {
    console.error("[automation whatsapp get]", err);
    return NextResponse.json({ ok: false, error: "load_failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const enabled = body?.enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "enabled debe ser boolean" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  try {
    await setWhatsappAutoEnabled(supabase, enabled);
    return NextResponse.json({ ok: true, whatsappAutoEnabled: enabled });
  } catch (err) {
    console.error("[automation whatsapp post]", err);
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  }
}
