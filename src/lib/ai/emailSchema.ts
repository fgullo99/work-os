import { z } from "zod";

/**
 * Salida del Normalizer para threads de Gmail. Comparte filosofia y varios nombres de
 * campo con manualCaptureResultSchema (schema.ts) a proposito — mismo Priority/Risk/Follow-up
 * engine consume ambos — pero es un schema/prompt separado (ver src/lib/ai/emailPrompt.ts):
 * mezclar las instrucciones de "una frase suelta" con "thread completo con direccion
 * INBOUND/OUTBOUND" hacia el prompt de captura manual confuso para ambos casos.
 */
export const emailThreadResultSchema = z.object({
  classification: z
    .enum(["ACTION", "WAITING", "COMMITMENT", "INFO", "IGNORE"])
    .describe("Clasificacion dominante del thread."),

  next_action: z.string().min(1).max(200).nullable().describe("Que tiene que hacer el usuario. Null si no aplica."),
  waiting_for_person: z.string().min(1).max(100).nullable(),
  waiting_for_what: z.string().min(1).max(200).nullable(),

  due_date_phrase: z.string().min(1).max(60).nullable(),
  expected_date_phrase: z.string().min(1).max(60).nullable(),
  committed_date_phrase: z.string().min(1).max(60).nullable(),

  is_delegation: z
    .boolean()
    .describe(
      "true si el usuario afirma explicitamente (en un mensaje OUTBOUND) que YA delegó/pidió/encargó esta accion a otra persona. Ver regla de delegacion en el prompt."
    ),

  suggested_company: z.string().min(1).max(100).nullable(),
  suggested_contact: z.string().min(1).max(100).nullable(),
  suggested_context: z.string().min(1).max(140).nullable(),
  suggested_category: z.enum(["COMERCIAL", "TECNICO", "OPERACIONES", "ADMINISTRATIVO"]).nullable(),

  blocking: z.boolean(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  rationale: z.string().min(1).max(200).describe("Explicacion corta de por que se interpreto asi."),
  evidence: z
    .string()
    .min(1)
    .max(300)
    .nullable()
    .describe("Cita textual corta de UNO de los mensajes que justifica la interpretacion. Null solo si classification=IGNORE. Nunca inventar."),
  summary: z.string().min(1).max(200),
});

export type EmailThreadResult = z.infer<typeof emailThreadResultSchema>;
