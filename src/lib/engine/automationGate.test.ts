import { describe, expect, it } from "vitest";
import { isAutoCreateEligible, classifyAutoUpdate, SAFE_AUTO_UPDATE_FIELDS } from "./automationGate";

const BASE_CREATE = {
  relevance: "WORK" as const,
  confidence: "HIGH" as const,
  hasClearActor: true,
  hasClearAction: true,
  directionConsistent: true,
  hasAmbiguousMatch: false,
};

describe("isAutoCreateEligible", () => {
  it("WORK + HIGH + evidencia clara + match no ambiguo -> elegible", () => {
    expect(isAutoCreateEligible(BASE_CREATE)).toBe(true);
  });

  it("relevance=PERSONAL nunca es elegible, aunque el resto sea perfecto", () => {
    expect(isAutoCreateEligible({ ...BASE_CREATE, relevance: "PERSONAL" })).toBe(false);
  });

  it("relevance=UNCERTAIN nunca es elegible", () => {
    expect(isAutoCreateEligible({ ...BASE_CREATE, relevance: "UNCERTAIN" })).toBe(false);
  });

  it("confidence=MEDIUM no es suficiente", () => {
    expect(isAutoCreateEligible({ ...BASE_CREATE, confidence: "MEDIUM" })).toBe(false);
  });

  it("sin actor claro -> no elegible", () => {
    expect(isAutoCreateEligible({ ...BASE_CREATE, hasClearActor: false })).toBe(false);
  });

  it("sin accion clara -> no elegible", () => {
    expect(isAutoCreateEligible({ ...BASE_CREATE, hasClearAction: false })).toBe(false);
  });

  it("direccion inconsistente (ej. WhatsApp unknown) -> no elegible", () => {
    expect(isAutoCreateEligible({ ...BASE_CREATE, directionConsistent: false })).toBe(false);
  });

  it("match ambiguo (mas de un candidato posible) -> no elegible", () => {
    expect(isAutoCreateEligible({ ...BASE_CREATE, hasAmbiguousMatch: true })).toBe(false);
  });
});

describe("classifyAutoUpdate", () => {
  it("WORK + HIGH + match no ambiguo + solo campos seguros -> AUTO_SAFE", () => {
    const result = classifyAutoUpdate({
      relevance: "WORK",
      confidence: "HIGH",
      changedFields: ["next_action", "due_date"],
      matchUnambiguous: true,
    });
    expect(result).toBe("AUTO_SAFE");
  });

  it("cualquier campo fuera de SAFE_AUTO_UPDATE_FIELDS (ej. company/context/responsible) -> REVIEW, aunque el resto sea HIGH", () => {
    const result = classifyAutoUpdate({
      relevance: "WORK",
      confidence: "HIGH",
      changedFields: ["next_action", "company_id"],
      matchUnambiguous: true,
    });
    expect(result).toBe("REVIEW");
  });

  it("relevance != WORK -> REVIEW", () => {
    const result = classifyAutoUpdate({
      relevance: "UNCERTAIN",
      confidence: "HIGH",
      changedFields: ["next_action"],
      matchUnambiguous: true,
    });
    expect(result).toBe("REVIEW");
  });

  it("confidence != HIGH -> REVIEW", () => {
    const result = classifyAutoUpdate({
      relevance: "WORK",
      confidence: "MEDIUM",
      changedFields: ["next_action"],
      matchUnambiguous: true,
    });
    expect(result).toBe("REVIEW");
  });

  it("match ambiguo -> REVIEW, aunque los campos sean seguros", () => {
    const result = classifyAutoUpdate({
      relevance: "WORK",
      confidence: "HIGH",
      changedFields: ["next_action"],
      matchUnambiguous: false,
    });
    expect(result).toBe("REVIEW");
  });

  it("sin campos a cambiar -> AUTO_SAFE (no hay nada riesgoso que tocar)", () => {
    const result = classifyAutoUpdate({ relevance: "WORK", confidence: "HIGH", changedFields: [], matchUnambiguous: true });
    expect(result).toBe("AUTO_SAFE");
  });

  it("SAFE_AUTO_UPDATE_FIELDS no incluye company/context/responsible/blocking/status", () => {
    const unsafe = ["company_id", "context_id", "responsible_id", "blocking", "status"];
    for (const field of unsafe) {
      expect((SAFE_AUTO_UPDATE_FIELDS as readonly string[]).includes(field)).toBe(false);
    }
  });
});
