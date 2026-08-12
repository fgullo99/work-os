import { z } from "zod";

/**
 * Salida del Normalizer para threads de Gmail. Comparte filosofia y varios nombres de
 * campo con manualCaptureResultSchema (schema.ts) a proposito — mismo Priority/Risk/Follow-up
 * engine consume ambos — pero es un schema/prompt separado (ver src/lib/ai/emailPrompt.ts):
 * mezclar las instrucciones de "una frase suelta" con "thread completo con direccion
 * INBOUND/OUTBOUND" hacia el prompt de captura manual confuso para ambos casos.
 */
export const emailThreadResultSchema = z.object({
  relevance: z
    .enum(["WORK", "PERSONAL", "UNCERTAIN"])
    .describe("Si el thread es laboral, personal, o no se puede determinar con confianza. Se evalua ANTES que classification."),

  classification: z
    .enum(["ACTION", "WAITING", "COMMITMENT", "INFO", "IGNORE"])
    .describe("Clasificacion dominante del thread."),

  attention_owner: z
    .enum(["FELIPE", "TEAM_OTHER", "EXTERNAL", "SHARED", "UNKNOWN"])
    .describe(
      "A quien le corresponde la proxima accion/decision real, evaluado DESPUES de relevance y classification. FELIPE si es inequivocamente suyo, TEAM_OTHER si es de otra persona interna (ver team_other_relation), EXTERNAL si se espera a un tercero (cliente/proveedor), SHARED SOLO si de verdad no se puede determinar responsable individual (si Felipe tiene un pedido explicito o una parte clara dentro de un pedido grupal, attention_owner es FELIPE, no SHARED), UNKNOWN si no se puede determinar. Ver reglas ATTENTION_OWNER."
    ),

  team_other_relation: z
    .enum(["DELEGATED_BY_FELIPE", "OWNED_BY_OTHER", "FYI_ONLY", "BLOCKS_FELIPE", "AMBIGUOUS"])
    .nullable()
    .describe(
      "Solo se completa cuando attention_owner=TEAM_OTHER — null en cualquier otro caso. DELEGATED_BY_FELIPE: Felipe delego esto explicitamente. OWNED_BY_OTHER: es tarea de otra persona, sin relacion con Felipe mas alla de estar en el hilo. FYI_ONLY: Felipe solo recibe copia informativa, sin pedido/compromiso/bloqueo/delegacion pendiente. BLOCKS_FELIPE: el resultado de lo que hace la otra persona bloquea una accion posterior de Felipe. AMBIGUOUS: no se puede determinar cual de las anteriores aplica. Ver reglas TEAM_OTHER_RELATION."
    ),

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
