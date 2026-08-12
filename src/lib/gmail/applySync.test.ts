import { describe, expect, it } from "vitest";
import { applyAutomationGate } from "./applySync";
import type { ActionPlan } from "./decisionEngine";

const ELIGIBLE = { createEligible: true, updateDecision: "AUTO_SAFE" as const };
const NOT_ELIGIBLE = { createEligible: false, updateDecision: "REVIEW" as const };

describe("applyAutomationGate", () => {
  it("safeMode=true (automation off) remaps CREATE_WORK_ITEM to REVIEW_NEW_WORK_ITEM, sin importar el gate estructural", () => {
    const plan: ActionPlan = { type: "CREATE_WORK_ITEM" };
    const result = applyAutomationGate(plan, true, ELIGIBLE);
    expect(result.plan).toEqual({ type: "REVIEW_NEW_WORK_ITEM" });
    expect(result.actionLabel).toBe("WOULD_CREATE (automation off)");
  });

  it("safeMode=true (automation off) remaps UPDATE_WORK_ITEM_SAFE a REVIEW_UPDATE_WORK_ITEM, manteniendo el workItemId", () => {
    const plan: ActionPlan = { type: "UPDATE_WORK_ITEM_SAFE", workItemId: "wi-1", fieldsToFill: ["next_action"] };
    const result = applyAutomationGate(plan, true, ELIGIBLE);
    expect(result.plan).toEqual({ type: "REVIEW_UPDATE_WORK_ITEM", workItemId: "wi-1" });
    expect(result.actionLabel).toBe("WOULD_UPDATE (automation off)");
  });

  it("safeMode=false + gate elegible -> CREATE_WORK_ITEM pasa como AUTO_CREATE", () => {
    const plan: ActionPlan = { type: "CREATE_WORK_ITEM" };
    const result = applyAutomationGate(plan, false, ELIGIBLE);
    expect(result.plan).toEqual(plan);
    expect(result.actionLabel).toBe("AUTO_CREATE");
  });

  it("safeMode=false + gate NO elegible -> CREATE_WORK_ITEM cae a REVIEW_NEW_WORK_ITEM (no crea solo)", () => {
    const plan: ActionPlan = { type: "CREATE_WORK_ITEM" };
    const result = applyAutomationGate(plan, false, NOT_ELIGIBLE);
    expect(result.plan).toEqual({ type: "REVIEW_NEW_WORK_ITEM" });
    expect(result.actionLabel).toBe("REVIEW (below auto-create threshold)");
  });

  it("safeMode=false + updateDecision AUTO_SAFE -> UPDATE_WORK_ITEM_SAFE pasa como AUTO_UPDATE", () => {
    const plan: ActionPlan = { type: "UPDATE_WORK_ITEM_SAFE", workItemId: "wi-2", fieldsToFill: ["due_date"] };
    const result = applyAutomationGate(plan, false, ELIGIBLE);
    expect(result.plan).toEqual(plan);
    expect(result.actionLabel).toBe("AUTO_UPDATE");
  });

  it("safeMode=false + updateDecision REVIEW -> UPDATE_WORK_ITEM_SAFE cae a REVIEW_UPDATE_WORK_ITEM (no pisa solo)", () => {
    const plan: ActionPlan = { type: "UPDATE_WORK_ITEM_SAFE", workItemId: "wi-3", fieldsToFill: ["due_date"] };
    const result = applyAutomationGate(plan, false, NOT_ELIGIBLE);
    expect(result.plan).toEqual({ type: "REVIEW_UPDATE_WORK_ITEM", workItemId: "wi-3" });
    expect(result.actionLabel).toBe("REVIEW (update fuera de la lista segura)");
  });

  it("no toca REVIEW_*, IGNORE, NO_OP ni RECEIVED_CHECK, sin importar safeMode ni el gate", () => {
    const plans: ActionPlan[] = [
      { type: "IGNORE", reason: "x" },
      { type: "NO_OP", workItemId: "wi-6" },
      { type: "RECEIVED_CHECK", workItemId: "wi-4" },
      { type: "REVIEW_NEW_WORK_ITEM" },
      { type: "REVIEW_UPDATE_WORK_ITEM", workItemId: "wi-5" },
      { type: "REVIEW_POTENTIAL_COMMITMENT" },
      { type: "REVIEW_POSSIBLE_DUPLICATE", candidateIds: ["a"] },
    ];
    for (const plan of plans) {
      expect(applyAutomationGate(plan, true, ELIGIBLE)).toEqual({ plan, actionLabel: plan.type });
      expect(applyAutomationGate(plan, false, ELIGIBLE)).toEqual({ plan, actionLabel: plan.type });
      expect(applyAutomationGate(plan, false, NOT_ELIGIBLE)).toEqual({ plan, actionLabel: plan.type });
    }
  });
});
