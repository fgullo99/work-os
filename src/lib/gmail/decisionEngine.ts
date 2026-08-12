import type { WorkItemRow } from "@/lib/supabase/types";

/**
 * Forma minima y ya resuelta (fechas ISO, no frases) que necesita el decision engine.
 * Separado de EmailThreadResult a proposito: el decision engine es una funcion pura,
 * testeable sin tocar la IA ni el resolver de fechas — recibe solo lo que necesita decidir.
 */
export type AttentionOwner = "FELIPE" | "TEAM_OTHER" | "EXTERNAL" | "SHARED" | "UNKNOWN";

/** Solo aplica cuando attentionOwner=TEAM_OTHER — ver TEAM_OTHER_RELATION en emailPrompt.ts. */
export type TeamOtherRelation = "DELEGATED_BY_FELIPE" | "OWNED_BY_OTHER" | "FYI_ONLY" | "BLOCKS_FELIPE" | "AMBIGUOUS";

export interface ResolvedClassification {
  relevance: "WORK" | "PERSONAL" | "UNCERTAIN";
  classification: "ACTION" | "WAITING" | "COMMITMENT" | "INFO" | "IGNORE";
  /** A quien le corresponde la proxima accion/decision real (ver ATTENTION_OWNER en
   * emailPrompt.ts). Gatea el auto-apply junto con teamOtherRelation — ver attentionGate(). */
  attentionOwner: AttentionOwner;
  /** null salvo que attentionOwner sea TEAM_OTHER. */
  teamOtherRelation: TeamOtherRelation | null;
  next_action: string | null;
  waiting_for_what: string | null;
  due_date: string | null;
  expected_date: string | null;
  committed_date: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

type AttentionGateOutcome =
  /** Se puede crear/actualizar automaticamente, como si fuera FELIPE. */
  | "PASS"
  /** No es trabajo personal de Felipe pero tampoco amerita Review — no crea nada nuevo, y si
   * ya existe un Work Item solo se refresca actividad (NO_OP), nunca se llena un campo. */
  | "SILENT"
  /** Ambiguedad real — requiere confirmacion humana. */
  | "REVIEW";

/**
 * Un solo lugar de verdad para el gate de ATTENTION_OWNER. Deliberadamente NO manda todo lo
 * que no es FELIPE/EXTERNAL a Review — eso convertiria Review en una segunda bandeja de
 * entrada (ver refinamiento del pedido). TEAM_OTHER se resuelve por su sub-relacion:
 * DELEGATED_BY_FELIPE/BLOCKS_FELIPE pasan igual que si fuera Felipe (son items legitimos de
 * SU tablero: algo que delego, o algo que lo bloquea); OWNED_BY_OTHER/FYI_ONLY no generan
 * nada para el tablero personal pero tampoco piden confirmacion (SILENT); solo AMBIGUOUS (y
 * SHARED/UNKNOWN, que ya son ambiguos por definicion) van a Review.
 */
function attentionGate(owner: AttentionOwner, teamOtherRelation: TeamOtherRelation | null): AttentionGateOutcome {
  if (owner === "FELIPE" || owner === "EXTERNAL") return "PASS";
  if (owner === "TEAM_OTHER") {
    switch (teamOtherRelation) {
      case "DELEGATED_BY_FELIPE":
      case "BLOCKS_FELIPE":
        return "PASS";
      case "OWNED_BY_OTHER":
      case "FYI_ONLY":
        return "SILENT";
      case "AMBIGUOUS":
      default:
        return "REVIEW";
    }
  }
  // SHARED, UNKNOWN: ambiguos por definicion.
  return "REVIEW";
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
    // ATTENTION_OWNER: PASS sigue el camino normal; SILENT (tarea ajena sin ambiguedad, ej.
    // OWNED_BY_OTHER/FYI_ONLY) no actualiza nada pero tampoco pide Review; solo REVIEW
    // (ambiguedad real) fuerza confirmacion humana.
    const gate = attentionGate(classification.attentionOwner, classification.teamOtherRelation);
    if (gate === "REVIEW") {
      return { type: "REVIEW_UPDATE_WORK_ITEM", workItemId: existingWorkItem.id };
    }
    if (gate === "SILENT") {
      return { type: "NO_OP", workItemId: existingWorkItem.id };
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

  // ATTENTION_OWNER: mismo gate que en el branch de existingWorkItem. PASS (FELIPE/EXTERNAL,
  // o TEAM_OTHER delegado por Felipe / que lo bloquea) sigue el camino normal de creacion.
  // SILENT (tarea ajena sin ambiguedad) nunca crea un Work Item, pero tampoco genera Review
  // — no queremos que Review se llene de FYI/tareas de otras personas. Solo REVIEW
  // (ambiguedad real: SHARED/UNKNOWN/AMBIGUOUS) pide confirmacion.
  const gate = attentionGate(classification.attentionOwner, classification.teamOtherRelation);
  if (gate === "REVIEW") {
    return { type: "REVIEW_NEW_WORK_ITEM" };
  }
  if (gate === "SILENT") {
    return { type: "IGNORE", reason: `attention_owner=TEAM_OTHER (${classification.teamOtherRelation}), no requiere Work Item personal` };
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
