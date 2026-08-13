import { describe, expect, it } from "vitest";
import { caseStateResultSchema } from "./caseSchema";

function validPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    case_title: "Cotización S00103",
    reference_type: "QUOTE",
    reference_value: "S00103",
    current_state: "WAITING_EXTERNAL",
    current_owner: "EXTERNAL",
    felipe_action_required: false,
    next_action: null,
    waiting_for: "Respuesta del cliente a la oferta enviada",
    responsible: null,
    due_date_phrase: null,
    expected_date_phrase: null,
    last_meaningful_event: "Thomas realizó seguimiento al cliente",
    risk: "NORMAL",
    confidence: "HIGH",
    closure_evidence_unambiguous: false,
    summary: "TMC envió la oferta y luego hizo seguimiento. El cliente aún no respondió.",
    ...overrides,
  };
}

describe("caseStateResultSchema", () => {
  it("acepta un payload valido con el shape del ejemplo del pedido", () => {
    const parsed = caseStateResultSchema.safeParse(validPayload());
    expect(parsed.success).toBe(true);
  });

  it("rechaza un current_state fuera de los 7 estados definidos", () => {
    const parsed = caseStateResultSchema.safeParse(validPayload({ current_state: "IN_PROGRESS" }));
    expect(parsed.success).toBe(false);
  });

  it("rechaza un current_owner fuera de los 5 valores definidos", () => {
    const parsed = caseStateResultSchema.safeParse(validPayload({ current_owner: "MANAGER" }));
    expect(parsed.success).toBe(false);
  });

  it("acepta reference_type/reference_value en null (no siempre hay referencia)", () => {
    const parsed = caseStateResultSchema.safeParse(validPayload({ reference_type: null, reference_value: null }));
    expect(parsed.success).toBe(true);
  });

  it("un summary de mas de 200 caracteres NO rechaza el parse — se normaliza (mismo fix que emailSchema)", () => {
    const parsed = caseStateResultSchema.safeParse(validPayload({ summary: "a".repeat(300) }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.summary.length).toBeLessThanOrEqual(200);
  });

  it("felipe_action_required y closure_evidence_unambiguous son booleanos obligatorios", () => {
    const { felipe_action_required, ...withoutField } = validPayload();
    const parsed = caseStateResultSchema.safeParse(withoutField);
    expect(parsed.success).toBe(false);
  });
});
