import type { WorkItemRow } from "@/lib/supabase/types";

/**
 * Forma minima y ya resuelta (fechas ISO, no frases) que necesita el decision engine.
 * Separado de EmailThreadResult a proposito: el decision engine es una funcion pura,
 * testeable sin tocar la IA ni el resolver de fechas — recibe solo lo que necesita decidir.
 */
export interface ResolvedClassification {
  relevance: "WORK" | "PERSONAL" | "UNCERTAIN";
  classification: "ACTION" | "WAITING" | "COMMITMENT" | "INFO" | "IGNORE";
  next_action: string | null;
  waiting_for_what: string | null;
  due_date: string | null;
  expected_date: string | null;
  committed_date: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
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
 * llenar campos vacios" para los dos canales, un solo lugar de verdad. */
export function safeFieldsToFill(
  classification: Pick<ResolvedClassification, TrackedField>,
  existing: WorkItemRow
): TrackedField[] {
  return TRACKED_FIELDS.filter((f) => existing[f] === null && classification[f] !== null);
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
    return {
      type: "UPDATE_WORK_ITEM_SAFE",
      workItemId: existingWorkItem.id,
      fieldsToFill: safeFieldsToFill(classification, existingWorkItem),
    };
  }

  // No hay Work Item existente para este thread todavia.
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
