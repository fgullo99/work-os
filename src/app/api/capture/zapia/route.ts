import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getAIProvider } from "@/lib/ai";
import { todayInTimezone } from "@/lib/dates/timezone";
import { isAuthorizedBearer } from "@/lib/auth/bearerToken";
import { parseZapiaPayload } from "@/lib/whatsapp/zapiaSchema";
import { processZapiaConversation, type ZapiaConversationLogEntry } from "@/lib/whatsapp/zapiaPipeline";

/**
 * Webhook dedicado para Zapia (WhatsApp → Zapia → Work OS, seccion 1 del spec). Endpoint
 * propio, no reutiliza /api/capture/normalize ni /api/capture/whatsapp: autentica con su
 * propio secret (ZAPIA_WEBHOOK_SECRET) y acepta un contrato de payload distinto (conversacion
 * completa con direccion por mensaje, no una sola frase). Exento del gate de sesion en
 * src/middleware.ts, igual que /api/gmail/sync y /api/capture/whatsapp.
 *
 * Zapia es SOURCE/INGESTION unicamente: este endpoint nunca crea ni actualiza un Work Item
 * directo. Todo lo que no sea IGNORE termina en Review (ver zapiaDecision.ts).
 */
export async function POST(request: Request) {
  const expectedToken = process.env.ZAPIA_WEBHOOK_SECRET;
  if (!expectedToken) {
    return NextResponse.json({ ok: false, error: "zapia_not_configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!isAuthorizedBearer(authHeader, expectedToken)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseZapiaPayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const aiProvider = getAIProvider();
  const todayISO = todayInTimezone();

  const summary = {
    received: parsed.units.length,
    processed: 0,
    ignored: 0,
    review_created: 0,
    duplicates: 0,
    failed: 0,
  };
  const log: ZapiaConversationLogEntry[] = [];

  for (const unit of parsed.units) {
    const entry = await processZapiaConversation({ supabase, aiProvider, todayISO }, unit);
    log.push(entry);

    // Observabilidad minima: nunca loguear el texto de los mensajes, solo metadata de
    // decision (mismo criterio que [gmail sync] en src/lib/gmail/sync.ts).
    console.log(
      `[zapia capture] chat=${entry.chatId ?? "-"} outcome=${entry.outcome} classification=${entry.classification ?? "-"} confidence=${entry.confidence ?? "-"}`
    );

    switch (entry.outcome) {
      case "duplicate":
        summary.duplicates += 1;
        break;
      case "failed":
        summary.failed += 1;
        break;
      case "ignored":
        summary.processed += 1;
        summary.ignored += 1;
        break;
      case "review_created":
        summary.processed += 1;
        summary.review_created += 1;
        break;
    }
  }

  return NextResponse.json({ ok: true, summary, log });
}
