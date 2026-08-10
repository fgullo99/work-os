import { describe, expect, it } from "vitest";
import { decideZapiaAction } from "./zapiaDecision";
import type { WorkItemRow } from "@/lib/supabase/types";

const baseWorkItem = { id: "wi-1" } as WorkItemRow;

describe("decideZapiaAction", () => {
  it("ignores when classification is IGNORE, regardless of matches", () => {
    const plan = decideZapiaAction({
      classification: "IGNORE",
      existingWorkItem: baseWorkItem,
      duplicateCandidateIds: ["x"],
    });
    expect(plan).toEqual({ type: "IGNORE", reason: "classification=IGNORE" });
  });

  it("proposes an UPDATE when an existing Work Item matches by chat_id", () => {
    const plan = decideZapiaAction({
      classification: "ACTION",
      existingWorkItem: baseWorkItem,
      duplicateCandidateIds: [],
    });
    expect(plan).toEqual({ type: "REVIEW_UPDATE_WORK_ITEM", workItemId: "wi-1" });
  });

  it("proposes a POSSIBLE_DUPLICATE when there is no exact match but heuristic candidates exist", () => {
    const plan = decideZapiaAction({
      classification: "WAITING",
      existingWorkItem: null,
      duplicateCandidateIds: ["a", "b"],
    });
    expect(plan).toEqual({ type: "REVIEW_POSSIBLE_DUPLICATE", candidateIds: ["a", "b"] });
  });

  it("proposes a NEW work item when there is no match at all", () => {
    const plan = decideZapiaAction({ classification: "COMMITMENT", existingWorkItem: null, duplicateCandidateIds: [] });
    expect(plan).toEqual({ type: "REVIEW_NEW_WORK_ITEM" });
  });

  it("never returns a type other than IGNORE or REVIEW_* — there is no auto-create/auto-update path", () => {
    // La firma de ZapiaActionPlan ni siquiera incluye CREATE_WORK_ITEM/UPDATE_WORK_ITEM_SAFE
    // (a diferencia del decision engine de Gmail) — este test documenta esa garantia en
    // runtime para las 5 clasificaciones no-IGNORE.
    const classifications = ["ACTION", "WAITING", "COMMITMENT", "INFO"] as const;
    for (const classification of classifications) {
      const plan = decideZapiaAction({ classification, existingWorkItem: null, duplicateCandidateIds: [] });
      expect(plan.type).toBe("REVIEW_NEW_WORK_ITEM");
    }
  });
});
