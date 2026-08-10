import { z } from "zod";

/**
 * Contrato de POST /api/capture/zapia. Zapia es SOURCE/INGESTION unicamente — este schema
 * valida forma, no decide nada de negocio (eso lo hace el Normalizer + decision engine en
 * zapiaPipeline.ts). Acepta dos formas: una conversacion suelta, o un batch de varias
 * conversaciones en un mismo POST (seccion 10 del spec).
 */
export const zapiaMessageSchema = z.object({
  message_id: z.string().min(1).nullable().optional(),
  direction: z.enum(["inbound", "outbound", "unknown"]).default("unknown"),
  sent_at: z.string().nullable().optional(),
  text: z.string().min(1).max(4000),
});

export const zapiaConversationSchema = z.object({
  chat_name: z.string().nullable().optional(),
  contact_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  chat_id: z.string().nullable().optional(),
});

const zapiaSingleConversationPayloadSchema = z.object({
  source: z.literal("whatsapp"),
  provider: z.literal("zapia"),
  batch_id: z.string().nullable().optional(),
  captured_at: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  conversation: zapiaConversationSchema,
  messages: z.array(zapiaMessageSchema).min(1).max(200),
});

const zapiaBatchConversationEntrySchema = z.object({
  conversation: zapiaConversationSchema,
  messages: z.array(zapiaMessageSchema).min(1).max(200),
  captured_at: z.string().nullable().optional(),
});

const zapiaBatchPayloadSchema = z.object({
  source: z.literal("whatsapp").optional(),
  provider: z.literal("zapia").optional(),
  batch_id: z.string().min(1),
  timezone: z.string().nullable().optional(),
  conversations: z.array(zapiaBatchConversationEntrySchema).min(1).max(50),
});

export type ZapiaMessage = z.infer<typeof zapiaMessageSchema>;
export type ZapiaConversation = z.infer<typeof zapiaConversationSchema>;

/** Una conversacion ya "aplanada", lista para procesar, sin importar si llego suelta o
 * dentro de un batch. */
export interface ZapiaConversationUnit {
  batchId: string | null;
  capturedAt: string | null;
  timezone: string | null;
  conversation: ZapiaConversation;
  messages: ZapiaMessage[];
}

export type ParseZapiaPayloadResult =
  | { ok: true; units: ZapiaConversationUnit[] }
  | { ok: false; error: string };

/** Valida el body crudo del webhook y lo aplana a una lista de conversaciones. Distingue
 * batch vs single por la presencia de `conversations` (mas confiable que un z.union, que
 * da errores dificiles de leer cuando las dos formas casi calzan). */
export function parseZapiaPayload(body: unknown): ParseZapiaPayloadResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "El body debe ser un objeto JSON." };
  }

  const isBatch = Array.isArray((body as Record<string, unknown>).conversations);

  if (isBatch) {
    const parsed = zapiaBatchPayloadSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const units = parsed.data.conversations.map((entry) => ({
      batchId: parsed.data.batch_id,
      capturedAt: entry.captured_at ?? null,
      timezone: parsed.data.timezone ?? null,
      conversation: entry.conversation,
      messages: entry.messages,
    }));
    return { ok: true, units };
  }

  const parsed = zapiaSingleConversationPayloadSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return {
    ok: true,
    units: [
      {
        batchId: parsed.data.batch_id ?? null,
        capturedAt: parsed.data.captured_at ?? null,
        timezone: parsed.data.timezone ?? null,
        conversation: parsed.data.conversation,
        messages: parsed.data.messages,
      },
    ],
  };
}
