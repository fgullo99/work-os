import { describe, expect, it } from "vitest";
import { decideZapiaAction, applyZapiaAutomationGate } from "./zapiaDecision";
import type { WorkItemRow } from "@/lib/supabase/types";

const baseWorkItem = { id: "wi-1" } as WorkItemRow;

describe("decideZapiaAction", () => {
  it("ignores when relevance is PERSONAL, regardless of classification or matches", () => {
    const plan = decideZapiaAction({
      relevance: "PERSONAL",
      classification: "ACTION",
      existingWorkItem: baseWorkItem,
      duplicateCandidateIds: ["x"],
    });
    expect(plan).toEqual({ type: "IGNORE", reason: "relevance=PERSONAL" });
  });

  it("ignores when classification is IGNORE, regardless of matches", () => {
    const plan = decideZapiaAction({
      relevance: "WORK",
      classification: "IGNORE",
      existingWorkItem: baseWorkItem,
      duplicateCandidateIds: ["x"],
    });
    expect(plan).toEqual({ type: "IGNORE", reason: "classification=IGNORE" });
  });

  it("proposes an UPDATE when an existing Work Item matches by chat_id", () => {
    const plan = decideZapiaAction({
      relevance: "WORK",
      classification: "ACTION",
      existingWorkItem: baseWorkItem,
      duplicateCandidateIds: [],
    });
    expect(plan).toEqual({ type: "REVIEW_UPDATE_WORK_ITEM", workItemId: "wi-1" });
  });

  it("proposes a POSSIBLE_DUPLICATE when there is no exact match but heuristic candidates exist", () => {
    const plan = decideZapiaAction({
      relevance: "WORK",
      classification: "WAITING",
      existingWorkItem: null,
      duplicateCandidateIds: ["a", "b"],
    });
    expect(plan).toEqual({ type: "REVIEW_POSSIBLE_DUPLICATE", candidateIds: ["a", "b"] });
  });

  it("proposes a NEW work item when there is no match at all", () => {
    const plan = decideZapiaAction({
      relevance: "WORK",
      classification: "COMMITMENT",
      existingWorkItem: null,
      duplicateCandidateIds: [],
    });
    expect(plan).toEqual({ type: "REVIEW_NEW_WORK_ITEM" });
  });

  it("por si sola (sin el gate de automatizacion), nunca devuelve algo distinto de IGNORE o REVIEW_*", () => {
    const classifications = ["ACTION", "WAITING", "COMMITMENT", "INFO"] as const;
    for (const classification of classifications) {
      const plan = decideZapiaAction({ relevance: "WORK", classification, existingWorkItem: null, duplicateCandidateIds: [] });
      expect(plan.type).toBe("REVIEW_NEW_WORK_ITEM");
    }
  });
});

describe("applyZapiaAutomationGate", () => {
  const ELIGIBLE = { createEligible: true, updateDecision: "AUTO_SAFE" as const };
  const NOT_ELIGIBLE = { createEligible: false, updateDecision: "REVIEW" as const };

  it("whatsappAutoEnabled=false (default/kill switch) deja todo como REVIEW_*, sin importar el gate", () => {
    const plan = applyZapiaAutomationGate({ type: "REVIEW_NEW_WORK_ITEM" }, false, ELIGIBLE);
    expect(plan).toEqual({ type: "REVIEW_NEW_WORK_ITEM" });
  });

  it("whatsappAutoEnabled=true + createEligible -> REVIEW_NEW_WORK_ITEM sube a CREATE_WORK_ITEM", () => {
    const plan = applyZapiaAutomationGate({ type: "REVIEW_NEW_WORK_ITEM" }, true, ELIGIBLE);
    expect(plan).toEqual({ type: "CREATE_WORK_ITEM" });
  });

  it("whatsappAutoEnabled=true + NO elegible -> REVIEW_NEW_WORK_ITEM se queda como esta", () => {
    const plan = applyZapiaAutomationGate({ type: "REVIEW_NEW_WORK_ITEM" }, true, NOT_ELIGIBLE);
    expect(plan).toEqual({ type: "REVIEW_NEW_WORK_ITEM" });
  });

  it("whatsappAutoEnabled=true + updateDecision AUTO_SAFE -> REVIEW_UPDATE_WORK_ITEM sube a UPDATE_WORK_ITEM_AUTO", () => {
    const plan = applyZapiaAutomationGate({ type: "REVIEW_UPDATE_WORK_ITEM", workItemId: "wi-9" }, true, ELIGIBLE);
    expect(plan).toEqual({ type: "UPDATE_WORK_ITEM_AUTO", workItemId: "wi-9" });
  });

  it("nunca toca IGNORE ni REVIEW_POSSIBLE_DUPLICATE, sin importar el toggle", () => {
    const ignore = { type: "IGNORE" as const, reason: "x" };
    const duplicate = { type: "REVIEW_POSSIBLE_DUPLICATE" as const, candidateIds: ["a"] };
    expect(applyZapiaAutomationGate(ignore, true, ELIGIBLE)).toEqual(ignore);
    expect(applyZapiaAutomationGate(duplicate, true, ELIGIBLE)).toEqual(duplicate);
  });
});
