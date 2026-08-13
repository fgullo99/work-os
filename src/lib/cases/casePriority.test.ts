import { describe, expect, it } from "vitest";
import { computeCasePriority, computeCaseRisk } from "./casePriority";
import type { CaseRow } from "@/lib/supabase/types";

const TODAY = "2026-08-13";

function caseRow(overrides: Partial<CaseRow> = {}): CaseRow {
  return {
    id: "case-1",
    title: "Cotización X",
    company_id: null,
    contact_id: null,
    context_id: null,
    reference_type: null,
    reference_value: null,
    current_state: "WAITING_EXTERNAL",
    current_owner: "EXTERNAL",
    felipe_action_required: false,
    next_action: null,
    waiting_for: null,
    responsible: null,
    due_date: null,
    expected_date: null,
    risk: "NORMAL",
    confidence: "HIGH",
    ai_summary: null,
    last_meaningful_event: null,
    last_activity_at: TODAY,
    ai_calls_count: 0,
    ai_input_tokens: 0,
    ai_output_tokens: 0,
    is_demo: false,
    created_at: TODAY,
    updated_at: TODAY,
    ...overrides,
  };
}

describe("computeCasePriority", () => {
  it("felipe_action_required=true sube el score y aparece en el why", () => {
    const withAction = computeCasePriority(caseRow({ felipe_action_required: true }), TODAY);
    const without = computeCasePriority(caseRow({ felipe_action_required: false }), TODAY);
    expect(withAction.score).toBeGreaterThan(without.score);
    expect(withAction.why).toContain("Accion tuya pendiente");
  });

  it("due_date vencido -> DO_NOW", () => {
    const result = computeCasePriority(caseRow({ due_date: "2026-08-01" }), TODAY);
    expect(result.bucket).toBe("DO_NOW");
    expect(result.why).toContain("Vencido");
  });

  it("current_state=BLOCKED suma al score", () => {
    const result = computeCasePriority(caseRow({ current_state: "BLOCKED" }), TODAY);
    expect(result.why).toContain("Bloqueado");
  });

  it("sin señales -> CAN_WAIT, why generico", () => {
    const result = computeCasePriority(caseRow(), TODAY);
    expect(result.bucket).toBe("CAN_WAIT");
    expect(result.why).toBe("Sin urgencia detectada.");
  });
});

describe("computeCaseRisk", () => {
  it("CLOSED nunca esta en riesgo, sin importar fechas vencidas", () => {
    const result = computeCaseRisk(caseRow({ current_state: "CLOSED", due_date: "2026-01-01" }), TODAY);
    expect(result.isAtRisk).toBe(false);
  });

  it("NO_ACTION nunca esta en riesgo", () => {
    const result = computeCaseRisk(caseRow({ current_state: "NO_ACTION", due_date: "2026-01-01" }), TODAY);
    expect(result.isAtRisk).toBe(false);
  });

  it("due_date vencido -> at risk con razon", () => {
    const result = computeCaseRisk(caseRow({ due_date: "2026-08-01" }), TODAY);
    expect(result.isAtRisk).toBe(true);
    expect(result.reasons[0]).toContain("Vencido");
  });

  it("WAITING_EXTERNAL con expected_date vencido -> at risk", () => {
    const result = computeCaseRisk(caseRow({ current_state: "WAITING_EXTERNAL", expected_date: "2026-08-01" }), TODAY);
    expect(result.isAtRisk).toBe(true);
    expect(result.reasons[0]).toContain("Esperando");
  });

  it("risk=AT_RISK de la IA sola alcanza, aunque no haya fechas vencidas", () => {
    const result = computeCaseRisk(caseRow({ risk: "AT_RISK" }), TODAY);
    expect(result.isAtRisk).toBe(true);
    expect(result.reasons).toContain("Marcado en riesgo por la IA");
  });

  it("BLOCKED con otra razon ya presente agrega 'Bloqueado'", () => {
    const result = computeCaseRisk(caseRow({ current_state: "BLOCKED", due_date: "2026-08-01" }), TODAY);
    expect(result.reasons).toContain("Bloqueado");
  });
});
