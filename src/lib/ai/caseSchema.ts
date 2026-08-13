import { z } from "zod";
import { normalizeSummary } from "./textNormalize";

/**
 * Salida del AI Case Analyzer — el corazon del pivot a Case (ver item 7 del pedido). A
 * diferencia de emailThreadResultSchema (que clasifica UN email/thread aislado), esto
 * analiza la historia COMPLETA de un Case (uno o mas threads/fuentes) y responde una sola
 * pregunta: ¿cual es el estado ACTUAL del asunto, y quien tiene que actuar ahora?
 */
export const caseStateResultSchema = z.object({
  case_title: z.string().min(1).max(140).describe("Titulo corto y claro del asunto (ej. 'Cotización S00103'). No cambia salvo que el titulo original haya sido genérico/incorrecto."),

  reference_type: z
    .enum(["QUOTE", "PURCHASE_ORDER", "RFQ", "PROJECT", "INVOICE", "SALES_ORDER", "OTHER"])
    .nullable()
    .describe("Tipo de referencia del asunto, si hay una identificable. Null si no hay ninguna."),
  reference_value: z.string().min(1).max(60).nullable().describe("Numero/codigo de referencia (ej. 'S00103', 'OC40991'). Null si no hay."),

  current_state: z
    .enum(["ACTION_ME", "WAITING_EXTERNAL", "DELEGATED_INTERNAL", "BLOCKED", "NO_ACTION", "CLOSED", "REVIEW"])
    .describe("El estado ACTUAL del asunto — el ultimo evento pisa a los anteriores, nunca se suman estados historicos. Ver reglas CURRENT_STATE."),
  current_owner: z
    .enum(["FELIPE", "TEAM", "EXTERNAL", "NONE", "UNKNOWN"])
    .describe("Quien tiene la pelota ahora. TEAM si es un interno de TMC distinto de Felipe (ver roster). UNKNOWN solo si de verdad no se puede determinar."),
  felipe_action_required: z.boolean().describe("true SOLO si Felipe personalmente tiene algo pendiente ahora mismo. Actividad del equipo NO implica esto en true."),

  next_action: z.string().min(1).max(200).nullable().describe("Que tiene que hacer Felipe. Null si felipe_action_required=false."),
  waiting_for: z.string().min(1).max(200).nullable().describe("Que se espera (de un tercero o de un interno), si current_state es WAITING_EXTERNAL o DELEGATED_INTERNAL o BLOCKED."),
  responsible: z.string().min(1).max(100).nullable().describe("Nombre del interno de TMC responsable del paso actual, solo si current_owner=TEAM."),

  due_date_phrase: z.string().min(1).max(60).nullable().describe("Frase de fecha limite tal cual aparece en el texto, nunca resuelta a fecha concreta."),
  expected_date_phrase: z.string().min(1).max(60).nullable(),

  last_meaningful_event: z
    .string()
    .min(1)
    .max(160)
    .describe(
      "El evento de negocio mas reciente y significativo (ej. 'Oferta enviada', 'Thomas hizo seguimiento', 'Cliente confirmo OC') — NUNCA 'ultimo email recibido' como descripcion generica."
    ),

  risk: z.enum(["NORMAL", "AT_RISK"]),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  // Solo relevante si current_state=CLOSED: true unicamente si la evidencia de cierre es
  // inequivoca (cancelacion explicita, compra confirmada en otro lado, rechazo explicito).
  // Si hay CUALQUIER duda, current_state debe ser REVIEW, no CLOSED con esto en false.
  closure_evidence_unambiguous: z.boolean(),

  // Sin .max() a proposito — ver nota en emailSchema.ts. normalizeSummary() recorta
  // deterministicamente en vez de rechazar toda la clasificacion.
  summary: z
    .string()
    .min(1)
    .transform(normalizeSummary)
    .describe("Resumen narrativo corto en estilo humano (ej. 'Oferta enviada el 13/08. Thomas hizo seguimiento el 15/08. Sin respuesta del cliente. Felipe no tiene nada pendiente.')."),
});

export type CaseStateResult = z.infer<typeof caseStateResultSchema>;
