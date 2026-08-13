import { describe, expect, it } from "vitest";
import { emailThreadResultSchema } from "./emailSchema";

function validPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    relevance: "WORK",
    classification: "ACTION",
    attention_owner: "FELIPE",
    team_other_relation: null,
    next_action: "Responder al cliente",
    waiting_for_person: null,
    waiting_for_what: null,
    due_date_phrase: null,
    expected_date_phrase: null,
    committed_date_phrase: null,
    is_delegation: false,
    suggested_company: null,
    suggested_contact: null,
    suggested_context: null,
    suggested_category: null,
    blocking: false,
    confidence: "HIGH",
    rationale: "test",
    evidence: "test",
    summary: "resumen normal",
    ...overrides,
  };
}

describe("emailThreadResultSchema — summary no debe rechazar por longitud (bug demostrado)", () => {
  it("un summary de longitud normal (<=200) pasa sin cambios", () => {
    const parsed = emailThreadResultSchema.safeParse(validPayload({ summary: "Cliente pide cotizacion nueva" }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.summary).toBe("Cliente pide cotizacion nueva");
  });

  it("un summary de 237 caracteres (el caso real demostrado) NO rechaza el parse — SUCCESS, no retry", () => {
    const longSummary = "a".repeat(237);
    const parsed = emailThreadResultSchema.safeParse(validPayload({ summary: longSummary }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.summary.length).toBeLessThanOrEqual(200);
  });

  it("un summary de 400+ caracteres tambien pasa, normalizado a <=200", () => {
    const parsed = emailThreadResultSchema.safeParse(validPayload({ summary: "palabra ".repeat(80) }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.summary.length).toBeLessThanOrEqual(200);
  });

  it("un summary vacio (string) sigue siendo rechazado — la desviacion aceptada es de longitud maxima, no de contenido minimo", () => {
    const parsed = emailThreadResultSchema.safeParse(validPayload({ summary: "" }));
    expect(parsed.success).toBe(false);
  });
});
