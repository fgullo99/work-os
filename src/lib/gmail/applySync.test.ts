import { describe, expect, it } from "vitest";
import { applySafeMode } from "./applySync";
import type { ActionPlan } from "./decisionEngine";

describe("applySafeMode", () => {
  it("remaps CREATE_WORK_ITEM to REVIEW_NEW_WORK_ITEM when safe mode is on", () => {
    const plan: ActionPlan = { type: "CREATE_WORK_ITEM" };
    const result = applySafeMode(plan, true);
    expect(result.plan).toEqual({ type: "REVIEW_NEW_WORK_ITEM" });
    expect(result.actionLabel).toBe("WOULD_CREATE (safe mode)");
  });

  it("remaps UPDATE_WORK_ITEM_SAFE to REVIEW_UPDATE_WORK_ITEM when safe mode is on, keeping the workItemId", () => {
    const plan: ActionPlan = { type: "UPDATE_WORK_ITEM_SAFE", workItemId: "wi-1", fieldsToFill: ["next_action"] };
    const result = applySafeMode(plan, true);
    expect(result.plan).toEqual({ type: "REVIEW_UPDATE_WORK_ITEM", workItemId: "wi-1" });
    expect(result.actionLabel).toBe("WOULD_UPDATE (safe mode)");
  });

  it("leaves CREATE_WORK_ITEM and UPDATE_WORK_ITEM_SAFE untouched when safe mode is off", () => {
    const createPlan: ActionPlan = { type: "CREATE_WORK_ITEM" };
    expect(applySafeMode(createPlan, false)).toEqual({ plan: createPlan, actionLabel: "CREATE_WORK_ITEM" });

    const updatePlan: ActionPlan = { type: "UPDATE_WORK_ITEM_SAFE", workItemId: "wi-2", fieldsToFill: [] };
    expect(applySafeMode(updatePlan, false)).toEqual({ plan: updatePlan, actionLabel: "UPDATE_WORK_ITEM_SAFE" });
  });

  it("does not touch REVIEW_*, IGNORE or RECEIVED_CHECK plans regardless of safe mode", () => {
    const plans: ActionPlan[] = [
      { type: "IGNORE", reason: "x" },
      { type: "RECEIVED_CHECK", workItemId: "wi-3" },
      { type: "REVIEW_NEW_WORK_ITEM" },
      { type: "REVIEW_UPDATE_WORK_ITEM", workItemId: "wi-4" },
      { type: "REVIEW_POTENTIAL_COMMITMENT" },
      { type: "REVIEW_POSSIBLE_DUPLICATE", candidateIds: ["a"] },
    ];
    for (const plan of plans) {
      expect(applySafeMode(plan, true)).toEqual({ plan, actionLabel: plan.type });
      expect(applySafeMode(plan, false)).toEqual({ plan, actionLabel: plan.type });
    }
  });
});
