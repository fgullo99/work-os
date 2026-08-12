/**
 * AI Autonomy: decide si una propuesta de la IA (Gmail o WhatsApp) puede aplicarse
 * automaticamente o si tiene que pasar por Review. Puro, sin I/O — usado por
 * src/lib/gmail/decisionEngine.ts y src/lib/whatsapp/zapiaDecision.ts, un solo lugar de
 * verdad para el criterio en vez de duplicarlo por canal.
 *
 * Deliberadamente mas estricto para UPDATE que para CREATE: crear un Work Item nuevo es
 * reversible con un simple delete (ver Undo); pisar un campo de un Work Item YA en curso
 * es mas riesgoso porque puede tapar una decision humana anterior.
 */

export type Relevance = "WORK" | "PERSONAL" | "UNCERTAIN";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface AutoCreateInput {
  relevance: Relevance;
  confidence: Confidence;
  /** Hay un contacto o responsable identificado (suggested_contact, waiting_for_person, responsible). */
  hasClearActor: boolean;
  /** Hay una accion o espera concreta (next_action o waiting_for_what no nulos). */
  hasClearAction: boolean;
  /** La direccion del ultimo mensaje relevante es inequivoca (no "unknown"). */
  directionConsistent: boolean;
  /** Mas de un Work Item existente podria ser el mismo asunto. */
  hasAmbiguousMatch: boolean;
}

/**
 * Campos que un UPDATE puede tocar automaticamente sin pasar por Review. Deliberadamente
 * NO incluye company/context/responsible/deadlines-ya-cargados/status de cierre — esos
 * siempre van a Review aunque la confianza sea HIGH (ver classifyAutoUpdate).
 */
export const SAFE_AUTO_UPDATE_FIELDS = [
  "next_action",
  "waiting_for_what",
  "due_date",
  "expected_date",
  "committed_date",
  "last_activity_at",
  "ai_summary",
  "source_link",
  "evidence",
  "status_received",
] as const;
export type SafeAutoUpdateField = (typeof SAFE_AUTO_UPDATE_FIELDS)[number];

export interface AutoUpdateInput {
  relevance: Relevance;
  confidence: Confidence;
  /** Campos que la propuesta de la IA quiere tocar en este update. */
  changedFields: string[];
  /** El match con el Work Item existente es inequivoco (no hay mas de un candidato posible). */
  matchUnambiguous: boolean;
}

export type AutoUpdateDecision = "AUTO_SAFE" | "REVIEW";

/** WORK + HIGH + evidencia estructural clara + match no ambiguo. PERSONAL/UNCERTAIN nunca crean. */
export function isAutoCreateEligible(input: AutoCreateInput): boolean {
  return (
    input.relevance === "WORK" &&
    input.confidence === "HIGH" &&
    input.hasClearActor &&
    input.hasClearAction &&
    input.directionConsistent &&
    !input.hasAmbiguousMatch
  );
}

/**
 * Mas conservador que isAutoCreateEligible a proposito: incluso con WORK + HIGH + match
 * inequivoco, si el update toca algun campo fuera de SAFE_AUTO_UPDATE_FIELDS (company,
 * context, responsible, un deadline ya cargado, un cierre/DONE) va a Review sin excepcion.
 */
export function classifyAutoUpdate(input: AutoUpdateInput): AutoUpdateDecision {
  if (input.relevance !== "WORK" || input.confidence !== "HIGH" || !input.matchUnambiguous) {
    return "REVIEW";
  }
  const safeSet: readonly string[] = SAFE_AUTO_UPDATE_FIELDS;
  const allFieldsSafe = input.changedFields.every((f) => safeSet.includes(f));
  return allFieldsSafe ? "AUTO_SAFE" : "REVIEW";
}
