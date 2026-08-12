import type { WorkItemRow } from "@/lib/supabase/types";

export type ZapiaClassification = "ACTION" | "WAITING" | "COMMITMENT" | "INFO" | "IGNORE";
export type ZapiaRelevance = "WORK" | "PERSONAL" | "UNCERTAIN";

export type ZapiaActionPlan =
  | { type: "IGNORE"; reason: string }
  | { type: "REVIEW_NEW_WORK_ITEM" }
  | { type: "REVIEW_UPDATE_WORK_ITEM"; workItemId: string }
  | { type: "REVIEW_POSSIBLE_DUPLICATE"; candidateIds: string[] }
  | { type: "CREATE_WORK_ITEM" }
  | { type: "UPDATE_WORK_ITEM_AUTO"; workItemId: string };

export interface ZapiaDecisionInput {
  relevance: ZapiaRelevance;
  classification: ZapiaClassification;
  /** Match definitivo por mismo chat_id ya visto (ver zapiaMatch.ts#findWorkItemByChatId). */
  existingWorkItem: WorkItemRow | null;
  /** Matches heuristicos por contacto/empresa/context + similaridad de titulo — pueden
   * incluir Work Items de OTRAS fuentes (ej. Gmail), a proposito (seccion 8 del spec). */
  duplicateCandidateIds: string[];
}

/**
 * Decision engine de Zapia/WhatsApp. Decide QUE TIPO de propuesta corresponde (nueva,
 * update, posible duplicado, ignorar) — el resultado siempre es REVIEW_* por default.
 * Si esto se auto-aplica o no lo decide applyZapiaAutomationGate (mismo criterio que Gmail,
 * ver src/lib/engine/automationGate.ts), gateado ademas por
 * automation_settings.whatsapp_auto_enabled (arranca en false). Pura, sin IA ni DB — ver
 * zapiaDecision.test.ts.
 */
export function decideZapiaAction(input: ZapiaDecisionInput): ZapiaActionPlan {
  if (input.relevance === "PERSONAL") {
    return { type: "IGNORE", reason: "relevance=PERSONAL" };
  }

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

export interface ZapiaAutomationGateContext {
  createEligible: boolean;
  updateDecision: "AUTO_SAFE" | "REVIEW";
}

/**
 * Wrapper additivo, mismo espiritu que applyAutomationGate de Gmail: decideZapiaAction()
 * sigue sin saber nada de automatizacion. whatsappAutoEnabled=false (default, kill switch)
 * deja todo como REVIEW_* sin excepcion. true habilita upgradear a CREATE_WORK_ITEM /
 * UPDATE_WORK_ITEM_AUTO, pero solo lo que ademas pasa el gate estructural (relevance=WORK,
 * confidence=HIGH, evidencia clara, campos dentro de la lista segura).
 */
export function applyZapiaAutomationGate(
  plan: ZapiaActionPlan,
  whatsappAutoEnabled: boolean,
  gate: ZapiaAutomationGateContext
): ZapiaActionPlan {
  if (!whatsappAutoEnabled) return plan;

  if (plan.type === "REVIEW_NEW_WORK_ITEM" && gate.createEligible) {
    return { type: "CREATE_WORK_ITEM" };
  }
  if (plan.type === "REVIEW_UPDATE_WORK_ITEM" && gate.updateDecision === "AUTO_SAFE") {
    return { type: "UPDATE_WORK_ITEM_AUTO", workItemId: plan.workItemId };
  }
  return plan;
}
