import { describe, expect, it } from "vitest";
import { decideAction, type ResolvedClassification } from "./decisionEngine";
import type { WorkItemRow } from "@/lib/supabase/types";

const TODAY = "2026-08-10";

function classification(overrides: Partial<ResolvedClassification> = {}): ResolvedClassification {
  return {
    relevance: "WORK",
    classification: "ACTION",
    next_action: "Hacer algo",
    waiting_for_what: null,
    due_date: null,
    expected_date: null,
    committed_date: null,
    confidence: "HIGH",
    ...overrides,
  };
}

function workItem(overrides: Partial<WorkItemRow> = {}): WorkItemRow {
  return {
    id: "wi-1",
    title: "Item",
    context_id: null,
    company_id: null,
    contact_id: null,
    category: null,
    status: "OPEN",
    responsible_id: null,
    next_action: null,
    waiting_for_what: null,
    waiting_for_contact_id: null,
    due_date: null,
    expected_date: null,
    committed_date: null,
    follow_up_date: null,
    postponed_until: null,
    blocking: false,
    blocking_note: null,
    estimated_minutes: null,
    last_activity_at: TODAY,
    ai_summary: null,
    ai_confidence: null,
    last_message_direction: null,
    is_demo: false,
    created_at: TODAY,
    updated_at: TODAY,
    last_reconciled_at: null,
    last_reconciled_thread_version: null,
    ...overrides,
  };
}

describe("decideAction", () => {
  it("classification=IGNORE siempre resulta en IGNORE, sin importar el resto", () => {
    const plan = decideAction({
      classification: classification({ classification: "IGNORE", next_action: null, confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("HIGH + sin Work Item existente + sin duplicados -> CREATE_WORK_ITEM", () => {
    const plan = decideAction({
      classification: classification({ confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("CREATE_WORK_ITEM");
  });

  it("HIGH + sin Work Item existente + con duplicados -> REVIEW_POSSIBLE_DUPLICATE", () => {
    const plan = decideAction({
      classification: classification({ confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: ["wi-2"],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_POSSIBLE_DUPLICATE");
  });

  it("MEDIUM + sin Work Item existente -> REVIEW_NEW_WORK_ITEM", () => {
    const plan = decideAction({
      classification: classification({ confidence: "MEDIUM" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_NEW_WORK_ITEM");
  });

  it("LOW + no es OUTBOUND ACTION/COMMITMENT -> IGNORE", () => {
    const plan = decideAction({
      classification: classification({ confidence: "LOW" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("LOW + OUTBOUND + ACTION -> REVIEW_POTENTIAL_COMMITMENT", () => {
    const plan = decideAction({
      classification: classification({ confidence: "LOW", classification: "ACTION" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: true,
    });
    expect(plan.type).toBe("REVIEW_POTENTIAL_COMMITMENT");
  });

  it("LOW + OUTBOUND + WAITING (no es ACTION/COMMITMENT propio) -> IGNORE", () => {
    const plan = decideAction({
      classification: classification({ confidence: "LOW", classification: "WAITING" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: true,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("HIGH + existing + solo llena campos vacios -> UPDATE_WORK_ITEM_SAFE", () => {
    const plan = decideAction({
      classification: classification({ confidence: "HIGH", next_action: "Nueva accion", due_date: "2026-08-12" }),
      existingWorkItem: workItem({ next_action: null, due_date: null }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("UPDATE_WORK_ITEM_SAFE");
    if (plan.type === "UPDATE_WORK_ITEM_SAFE") {
      expect(plan.fieldsToFill).toContain("next_action");
      expect(plan.fieldsToFill).toContain("due_date");
    }
  });

  it("HIGH + existing + pisaria un campo ya cargado con otro valor -> REVIEW_UPDATE_WORK_ITEM (nunca se pisa solo)", () => {
    const plan = decideAction({
      classification: classification({ confidence: "HIGH", next_action: "Accion distinta" }),
      existingWorkItem: workItem({ next_action: "Accion original" }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_UPDATE_WORK_ITEM");
  });

  it("MEDIUM + existing -> siempre REVIEW_UPDATE_WORK_ITEM, nunca se aplica solo", () => {
    const plan = decideAction({
      classification: classification({ confidence: "MEDIUM" }),
      existingWorkItem: workItem(),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_UPDATE_WORK_ITEM");
  });

  it("existing WAITING + actividad inbound nueva -> RECEIVED_CHECK, tiene prioridad sobre todo lo demas", () => {
    const plan = decideAction({
      classification: classification({ confidence: "HIGH", classification: "INFO", next_action: null }),
      existingWorkItem: workItem({ waiting_for_what: "Planos" }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: true,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("RECEIVED_CHECK");
  });

  it("existing WAITING + actividad inbound nueva, incluso con classification=IGNORE -> sigue siendo RECEIVED_CHECK", () => {
    const plan = decideAction({
      classification: classification({ confidence: "LOW", classification: "IGNORE" }),
      existingWorkItem: workItem({ waiting_for_what: "Planos" }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: true,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("RECEIVED_CHECK");
  });

  it("existing sin waiting_for_what + inbound nueva -> NO dispara RECEIVED_CHECK (nada que resolver)", () => {
    const plan = decideAction({
      classification: classification({ confidence: "HIGH" }),
      existingWorkItem: workItem({ waiting_for_what: null, next_action: null }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: true,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).not.toBe("RECEIVED_CHECK");
  });

  it("relevance=PERSONAL siempre resulta en IGNORE, incluso con confidence HIGH y classification ACTION", () => {
    const plan = decideAction({
      classification: classification({ relevance: "PERSONAL", confidence: "HIGH", classification: "ACTION" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("relevance=PERSONAL con Work Item existente tambien resulta en IGNORE (no actualiza)", () => {
    const plan = decideAction({
      classification: classification({ relevance: "PERSONAL", confidence: "HIGH" }),
      existingWorkItem: workItem(),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("relevance=UNCERTAIN + HIGH + sin existing -> REVIEW_NEW_WORK_ITEM, nunca CREATE_WORK_ITEM", () => {
    const plan = decideAction({
      classification: classification({ relevance: "UNCERTAIN", confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_NEW_WORK_ITEM");
  });

  it("relevance=UNCERTAIN + HIGH + existing (llenaria campos vacios) -> REVIEW_UPDATE_WORK_ITEM, nunca UPDATE_WORK_ITEM_SAFE", () => {
    const plan = decideAction({
      classification: classification({ relevance: "UNCERTAIN", confidence: "HIGH", next_action: "Nueva accion" }),
      existingWorkItem: workItem({ next_action: null }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_UPDATE_WORK_ITEM");
  });

  it("relevance=WORK + HIGH + sin existing -> sigue siendo CREATE_WORK_ITEM (regresion)", () => {
    const plan = decideAction({
      classification: classification({ relevance: "WORK", confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("CREATE_WORK_ITEM");
  });
});
