import type { WorkItemRow } from "@/lib/supabase/types";

/**
 * Forma minima y ya resuelta (fechas ISO, no frases) que necesita el decision engine.
 * Separado de EmailThreadResult a proposito: el decision engine es una funcion pura,
 * testeable sin tocar la IA ni el resolver de fechas — recibe solo lo que necesita decidir.
 */
export type AttentionOwner = "FELIPE" | "TEAM_OTHER" | "EXTERNAL" | "SHARED" | "UNKNOWN";

export interface ResolvedClassification {
  relevance: "WORK" | "PERSONAL" | "UNCERTAIN";
  classification: "ACTION" | "WAITING" | "COMMITMENT" | "INFO" | "IGNORE";
  /** A quien le corresponde la proxima accion/decision real (ver ATTENTION_OWNER en
   * emailPrompt.ts). Gatea el auto-apply: nunca se crea/actualiza automaticamente un Work
   * Item si el owner no es FELIPE o EXTERNAL — TEAM_OTHER/SHARED/UNKNOWN siempre van a
   * Review, nunca se auto-asigna trabajo ajeno a Felipe. */
  attentionOwner: AttentionOwner;
  next_action: string | null;
  waiting_for_what: string | null;
  due_date: string | null;
  expected_date: string | null;
  committed_date: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

/** true si el owner NO es alguien para quien tiene sentido que Work OS mantenga
 * automaticamente un item en el tablero personal de Felipe (el o un tercero externo del que
 * esta esperando). TEAM_OTHER/SHARED/UNKNOWN siempre requieren confirmacion humana. */
function attentionOwnerRequiresReview(owner: AttentionOwner): boolean {
  return owner !== "FELIPE" && owner !== "EXTERNAL";
}

export interface DecisionInput {
  classification: ResolvedClassification;
  existingWorkItem: WorkItemRow | null;
  duplicateCandidateIds: string[];
  /** Llego un mensaje INBOUND nuevo desde la ultima vez que se proceso este Work Item. */
  hasNewInboundSinceLastSync: boolean;
  /** El mensaje mas reciente del thread lo escribio el propio usuario. */
  lastMessageIsOutbound: boolean;
}

export type ActionPlan =
  | { type: "IGNORE"; reason: string }
  | { type: "NO_OP"; workItemId: string }
  | { type: "RECEIVED_CHECK"; workItemId: string }
  | { type: "CREATE_WORK_ITEM" }
  | { type: "UPDATE_WORK_ITEM_SAFE"; workItemId: string; fieldsToFill: TrackedField[] }
  | { type: "REVIEW_NEW_WORK_ITEM" }
  | { type: "REVIEW_UPDATE_WORK_ITEM"; workItemId: string }
  | { type: "REVIEW_POTENTIAL_COMMITMENT" }
  | { type: "REVIEW_POSSIBLE_DUPLICATE"; candidateIds: string[] };

export const TRACKED_FIELDS = ["next_action", "waiting_for_what", "due_date", "expected_date", "committed_date"] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

/** Exportada para reuso desde src/lib/whatsapp/zapiaPipeline.ts — mismo criterio de "solo
 * llenar campos vacios" para los dos canales, un solo lugar de verdad.
 *
 * Excepcion deliberada, acotada: transicion ACTION resuelta -> WAITING. Si el usuario ya
 * tenia un next_action pendiente y el thread ahora vuelve WAITING con next_action=null Y
 * un waiting_for_what concreto, el next_action viejo quedo obsoleto (el usuario ya hizo su
 * parte) — es seguro limpiarlo a null porque sigue siendo un campo de la lista blanca
 * (SAFE_AUTO_UPDATE_FIELDS) y la señal que lo dispara es inequivoca (la propia
 * clasificacion dejo de reportar next_action). No toca waiting_for_what si ya tenia un
 * valor en conflicto — eso lo sigue bloqueando wouldOverwriteExistingValue como antes. */
export function safeFieldsToFill(
  classification: Pick<ResolvedClassification, TrackedField | "classification">,
  existing: WorkItemRow
): TrackedField[] {
  const filled = TRACKED_FIELDS.filter((f) => existing[f] === null && classification[f] !== null);

  const actionResolvedIntoWaiting =
    classification.classification === "WAITING" &&
    existing.next_action !== null &&
    classification.next_action === null &&
    classification.waiting_for_what !== null;
  if (actionResolvedIntoWaiting && !filled.includes("next_action")) {
    filled.push("next_action");
  }

  return filled;
}

/** true si aplicar la clasificacion nueva pisaria un valor YA cargado con uno distinto.
 * Exportada por el mismo motivo que safeFieldsToFill — reusada desde zapiaPipeline.ts para
 * que un update automatico de WhatsApp tampoco pueda "tapar" informacion en conflicto sin
 * pasar por Review, igual que Gmail. */
export function wouldOverwriteExistingValue(classification: Pick<ResolvedClassification, TrackedField>, existing: WorkItemRow): boolean {
  return TRACKED_FIELDS.some((f) => existing[f] !== null && classification[f] !== null && existing[f] !== classification[f]);
}

/**
 * Reglas de creacion/actualizacion/review (spec Etapa 2, secciones 11 y 17). Pura,
 * determinista, sin llamadas a IA ni DB — ver src/lib/gmail/decisionEngine.test.ts.
 */
export function decideAction(input: DecisionInput): ActionPlan {
  const { classification, existingWorkItem, duplicateCandidateIds, hasNewInboundSinceLastSync } = input;

  // Gate de relevancia, antes que todo lo demas: un thread PERSONAL nunca genera ni
  // actualiza un Work Item, sin importar confidence o classification.
  if (classification.relevance === "PERSONAL") {
    return { type: "IGNORE", reason: "relevance=PERSONAL" };
  }

  // Prioridad absoluta, independiente de confidence/classification: un Work Item WAITING
  // que recibe actividad inbound nueva NUNCA se cierra solo. Siempre se sugiere revisar.
  if (existingWorkItem?.waiting_for_what && hasNewInboundSinceLastSync) {
    return { type: "RECEIVED_CHECK", workItemId: existingWorkItem.id };
  }

  if (classification.classification === "IGNORE") {
    return { type: "IGNORE", reason: "classification=IGNORE" };
  }

  const isOutboundSelfCommitment =
    input.lastMessageIsOutbound && (classification.classification === "ACTION" || classification.classification === "COMMITMENT");

  if (classification.confidence === "LOW") {
    if (isOutboundSelfCommitment) return { type: "REVIEW_POTENTIAL_COMMITMENT" };
    return { type: "IGNORE", reason: "confidence=LOW y no es un posible compromiso propio (OUTBOUND ACTION/COMMITMENT)" };
  }

  if (existingWorkItem) {
    if (classification.confidence === "MEDIUM") {
      return { type: "REVIEW_UPDATE_WORK_ITEM", workItemId: existingWorkItem.id };
    }
    // HIGH + existe: solo autoaplicar si no pisa nada ya cargado. Si pisaria algo, a review.
    if (wouldOverwriteExistingValue(classification, existingWorkItem)) {
      return { type: "REVIEW_UPDATE_WORK_ITEM", workItemId: existingWorkItem.id };
    }
    // relevance=UNCERTAIN nunca es suficiente para auto-aplicar, aunque confidence sea HIGH.
    if (classification.relevance === "UNCERTAIN") {
      return { type: "REVIEW_UPDATE_WORK_ITEM", workItemId: existingWorkItem.id };
    }
    // ATTENTION_OWNER: si la proxima accion no es de Felipe ni de un tercero externo del que
    // esta esperando (TEAM_OTHER/SHARED/UNKNOWN), nunca se actualiza solo — evita
    // auto-asignarle a Felipe algo que en realidad le corresponde a otra persona.
    if (attentionOwnerRequiresReview(classification.attentionOwner)) {
      return { type: "REVIEW_UPDATE_WORK_ITEM", workItemId: existingWorkItem.id };
    }
    const fieldsToFill = safeFieldsToFill(classification, existingWorkItem);
    // Nada nuevo que llenar y nada en conflicto (ya descartado arriba): el thread tuvo
    // actividad pero no cambia el estado del Work Item — ej. un "sigo esperando" repetido,
    // o una confirmacion automatica sin accion. No es Review (no hay ambiguedad real) ni un
    // UPDATE de verdad (nada cambia) — solo se refresca last_activity_at/ai_summary.
    if (fieldsToFill.length === 0) {
      return { type: "NO_OP", workItemId: existingWorkItem.id };
    }
    return { type: "UPDATE_WORK_ITEM_SAFE", workItemId: existingWorkItem.id, fieldsToFill };
  }

  // No hay Work Item existente para este thread todavia.

  // INFO sin nada accionable (sin next_action/waiting_for_what/committed_date): el modelo
  // no lo clasifico como IGNORE, pero tampoco dejo nada para crear o revisar — ej. un
  // thread que la propia IA describe como "ya resuelto", sin ningun campo poblado.
  if (
    classification.classification === "INFO" &&
    classification.next_action === null &&
    classification.waiting_for_what === null &&
    classification.committed_date === null
  ) {
    return { type: "IGNORE", reason: "classification=INFO sin next_action/waiting_for_what/committed_date (nada accionable)" };
  }

  // ATTENTION_OWNER: nunca se crea automaticamente un Work Item personal para Felipe si la
  // proxima accion es de otra persona (TEAM_OTHER), del equipo sin responsable claro
  // (SHARED), o no se pudo determinar (UNKNOWN). Sigue pudiendo ir a Review si parece
  // importante — la diferencia es que jamas se auto-crea.
  if (attentionOwnerRequiresReview(classification.attentionOwner)) {
    return { type: "REVIEW_NEW_WORK_ITEM" };
  }

  if (duplicateCandidateIds.length > 0) {
    return { type: "REVIEW_POSSIBLE_DUPLICATE", candidateIds: duplicateCandidateIds };
  }

  if (classification.confidence === "MEDIUM") {
    return { type: "REVIEW_NEW_WORK_ITEM" };
  }

  // relevance=UNCERTAIN nunca es suficiente para auto-crear, aunque confidence sea HIGH.
  if (classification.relevance === "UNCERTAIN") {
    return { type: "REVIEW_NEW_WORK_ITEM" };
  }

  return { type: "CREATE_WORK_ITEM" };
}
