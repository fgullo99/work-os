import type { WorkItemRow } from "@/lib/supabase/types";

export type ZapiaClassification = "ACTION" | "WAITING" | "COMMITMENT" | "INFO" | "IGNORE";

export type ZapiaActionPlan =
  | { type: "IGNORE"; reason: string }
  | { type: "REVIEW_NEW_WORK_ITEM" }
  | { type: "REVIEW_UPDATE_WORK_ITEM"; workItemId: string }
  | { type: "REVIEW_POSSIBLE_DUPLICATE"; candidateIds: string[] };

export interface ZapiaDecisionInput {
  classification: ZapiaClassification;
  /** Match definitivo por mismo chat_id ya visto (ver zapiaMatch.ts#findWorkItemByChatId). */
  existingWorkItem: WorkItemRow | null;
  /** Matches heuristicos por contacto/empresa/context + similaridad de titulo — pueden
   * incluir Work Items de OTRAS fuentes (ej. Gmail), a proposito (seccion 8 del spec). */
  duplicateCandidateIds: string[];
}

/**
 * Decision engine de Zapia/WhatsApp — DELIBERADAMENTE mas simple que el de Gmail
 * (src/lib/gmail/decisionEngine.ts): en V1, TODO resultado relevante va a Review, incluso
 * HIGH confidence (seccion 7 del spec: "queremos medir calidad sobre conversaciones reales"
 * antes de confiar en auto-create/auto-update para este canal). confidence no entra en esta
 * decision en absoluto — solo decide QUE TIPO de sugerencia de Review se arma.
 * Pura, sin IA ni DB — ver zapiaDecision.test.ts.
 */
export function decideZapiaAction(input: ZapiaDecisionInput): ZapiaActionPlan {
  if (input.classification === "IGNORE") {
    return { type: "IGNORE", reason: "classification=IGNORE" };
  }

  if (input.existingWorkItem) {
    return { type: "REVIEW_UPDATE_WORK_ITEM", workItemId: input.existingWorkItem.id };
  }

  if (input.duplicateCandidateIds.length > 0) {
    return { type: "REVIEW_POSSIBLE_DUPLICATE", candidateIds: input.duplicateCandidateIds };
  }

  return { type: "REVIEW_NEW_WORK_ITEM" };
}
