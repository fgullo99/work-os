import { z } from "zod";

/**
 * Salida del Normalizer para conversaciones de WhatsApp (via Zapia). Mismo espiritu que
 * emailThreadResultSchema: analiza el BLOQUE de mensajes como conversacion (no mensaje por
 * mensaje), nunca calcula fechas concretas (frases, resueltas despues con
 * resolveDatePhrase). Schema separado del de email a proposito — la conversacion de
 * WhatsApp no tiene subject ni headers, y la nocion de "responsible" (alguien mas
 * responsable de resolver esto) es propia de este canal.
 */
export const whatsappConversationResultSchema = z.object({
  classification: z
    .enum(["ACTION", "WAITING", "COMMITMENT", "INFO", "IGNORE"])
    .describe("Clasificacion dominante de la conversacion."),

  next_action: z.string().min(1).max(200).nullable().describe("Que tiene que hacer el usuario. Null si no aplica."),
  waiting_for_person: z.string().min(1).max(100).nullable(),
  waiting_for_what: z.string().min(1).max(200).nullable(),

  due_date_phrase: z.string().min(1).max(60).nullable(),
  expected_date_phrase: z.string().min(1).max(60).nullable(),
  committed_date_phrase: z.string().min(1).max(60).nullable(),

  responsible: z
    .string()
    .min(1)
    .max(100)
    .nullable()
    .describe("Si el usuario ya delego esto explicitamente en otra persona, el nombre de esa persona. Null si el usuario sigue siendo el responsable."),

  suggested_company: z.string().min(1).max(100).nullable(),
  suggested_contact: z.string().min(1).max(100).nullable(),
  suggested_context: z.string().min(1).max(140).nullable(),
  suggested_category: z.enum(["COMERCIAL", "TECNICO", "OPERACIONES", "ADMINISTRATIVO"]).nullable(),

  blocking: z.boolean(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  evidence: z
    .string()
    .min(1)
    .max(300)
    .nullable()
    .describe("Cita textual corta de UNO de los mensajes que justifica la interpretacion. Null solo si classification=IGNORE. Nunca inventar."),
  summary: z.string().min(1).max(200),
});

export type WhatsAppConversationResult = z.infer<typeof whatsappConversationResultSchema>;
