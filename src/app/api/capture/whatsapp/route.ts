import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AINormalizationError, getAIProvider } from "@/lib/ai";
import { resolveDatePhrase } from "@/lib/dates/resolveDatePhrase";
import { todayInTimezone } from "@/lib/dates/timezone";
import { isAuthorizedBearer } from "@/lib/auth/bearerToken";

/**
 * Captura rapida desde afuera de la app (pensado para el Apple Shortcut documentado en
 * README.md#whatsapp-quick-capture): sin sesion de usuario, autentica con un bearer token
 * estatico (WHATSAPP_CAPTURE_TOKEN) — por eso esta ruta esta exenta del gate de sesion en
 * src/middleware.ts, igual que /api/gmail/sync con CRON_SECRET.
 *
 * A proposito NO crea un Work Item directo: pasa por el mismo Normalizer que la captura
 * manual y el resultado va a la bandeja de Review (kind=NEW_WORK_ITEM, source=WHATSAPP) —
 * una captura ciega desde el telefono no tiene UI para elegir/crear Company/Contact/Context
 * en el momento, asi que esa resolucion queda para cuando el usuario revise la sugerencia
 * (mismo camino que ya usa Gmail, ver src/lib/workItems/reviewItems.ts#acceptNewWorkItem).
 */
export async function POST(request: Request) {
  const expectedToken = process.env.WHATSAPP_CAPTURE_TOKEN;
  if (!expectedToken) {
    return NextResponse.json({ ok: false, error: "whatsapp_capture_not_configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!isAuthorizedBearer(authHeader, expectedToken)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const contactOverride = typeof body?.contact === "string" && body.contact.trim() ? body.contact.trim() : null;
  const contextOverride = typeof body?.context === "string" && body.context.trim() ? body.context.trim() : null;

  if (!text) {
    return NextResponse.json({ ok: false, error: "missing_text" }, { status: 400 });
  }

  const todayISO = todayInTimezone();

  try {
    const provider = getAIProvider();
    const result = await provider.normalizeManualCapture({ text, currentDateISO: todayISO });

    const classification = result.waiting_for_what ? "WAITING" : result.next_action ? "ACTION" : "INFO";

    const proposedPayload = {
      title: result.title,
      next_action: result.next_action,
      waiting_for_what: result.waiting_for_what,
      waiting_for_person: result.waiting_for_person,
      due_date: resolveDatePhrase(result.due_date_phrase, todayISO),
      expected_date: resolveDatePhrase(result.expected_date_phrase, todayISO),
      committed_date: resolveDatePhrase(result.committed_date_phrase, todayISO),
      suggested_company: result.suggested_company,
      suggested_contact: contactOverride ?? result.suggested_contact,
      suggested_context: contextOverride ?? result.suggested_context,
      suggested_category: result.suggested_category,
      blocking: result.blocking,
      is_delegation: false,
      classification,
    };

    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("review_item")
      .insert({
        kind: "NEW_WORK_ITEM",
        proposed_payload: proposedPayload,
        confidence: result.confidence,
        rationale: result.summary,
        evidence: text.slice(0, 500),
        source_type: "WHATSAPP",
        raw_excerpt: text.slice(0, 500),
        occurred_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, reviewItemId: (data as { id: string }).id });
  } catch (err) {
    console.error("[capture/whatsapp]", err);
    const message =
      err instanceof AINormalizationError
        ? "No pude interpretar el mensaje con suficiente confianza."
        : "Error inesperado al interpretar el mensaje.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
