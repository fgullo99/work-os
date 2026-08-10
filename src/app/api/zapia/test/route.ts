import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAIProvider } from "@/lib/ai";
import { todayInTimezone } from "@/lib/dates/timezone";
import { processZapiaConversation } from "@/lib/whatsapp/zapiaPipeline";
import type { ZapiaConversationUnit } from "@/lib/whatsapp/zapiaSchema";

/**
 * "Test Zapia Webhook" en Settings: corre una conversacion sintetica por el pipeline real
 * (mismo Normalizer, mismo matching, misma bandeja de Review) para confirmar que la
 * configuracion funciona de punta a punta, SIN pasar por el secret de Zapia (ya estamos
 * autenticados por sesion) y marcando todo lo que genera como is_demo=true — el boton
 * "Purge demo data" de Settings lo limpia despues.
 */
export async function POST() {
  const supabase = createSupabaseServerClient();
  try {
    const unit: ZapiaConversationUnit = {
      batchId: `test-${Date.now()}`,
      capturedAt: new Date().toISOString(),
      timezone: "America/Argentina/Buenos_Aires",
      conversation: {
        chat_name: "Test Zapia (Demo)",
        contact_name: "Contacto de prueba (Demo)",
        phone: null,
        chat_id: `test-chat-${Date.now()}`,
      },
      messages: [
        {
          message_id: `test-msg-${Date.now()}`,
          direction: "inbound",
          sent_at: new Date().toISOString(),
          text: "Che, mandame mañana el precio actualizado del trafo 1600 kVA.",
        },
      ],
    };

    const entry = await processZapiaConversation(
      { supabase, aiProvider: getAIProvider(), todayISO: todayInTimezone() },
      unit
    );

    if (entry.reviewItemId) {
      await supabase.from("review_item").update({ is_demo: true }).eq("id", entry.reviewItemId);
    }
    await supabase.from("whatsapp_ingestion").update({ is_demo: true }).eq("idempotency_key", entry.idempotencyKey);

    return NextResponse.json({ ok: true, outcome: entry.outcome, error: entry.error });
  } catch (err) {
    console.error("[zapia test]", err);
    return NextResponse.json({ ok: false, error: "test_failed" }, { status: 500 });
  }
}
