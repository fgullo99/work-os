import { describe, expect, it } from "vitest";
import { computeRisk } from "./risk";
import type { WorkItemRow } from "@/lib/supabase/types";

const TODAY = "2026-08-10";

function baseItem(overrides: Partial<WorkItemRow> = {}): WorkItemRow {
  return {
    id: "1",
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
    ...overrides,
  };
}

describe("computeRisk", () => {
  it("sin fechas vencidas no hay riesgo", () => {
    const result = computeRisk(baseItem({ due_date: "2026-08-20" }), TODAY);
    expect(result.isAtRisk).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  it("due_date pasado -> OVERDUE", () => {
    const result = computeRisk(baseItem({ due_date: "2026-08-01" }), TODAY);
    expect(result.isAtRisk).toBe(true);
    expect(result.reasons[0]).toMatch(/^Vencido desde/);
  });

  it("waiting con expected_date pasado -> WAITING_OVERDUE con dias", () => {
    const result = computeRisk(baseItem({ waiting_for_what: "Planos", expected_date: "2026-08-08" }), TODAY);
    expect(result.isAtRisk).toBe(true);
    expect(result.reasons[0]).toBe("Esperando hace 2 dias de atraso");
  });

  it("blocking amplifica agregando una razon extra, solo si ya hay riesgo", () => {
    const withoutRisk = computeRisk(baseItem({ blocking: true, blocking_note: "produccion" }), TODAY);
    expect(withoutRisk.isAtRisk).toBe(false);

    const withRisk = computeRisk(
      baseItem({ due_date: "2026-08-01", blocking: true, blocking_note: "produccion" }),
      TODAY
    );
    expect(withRisk.reasons).toContain("Bloquea: produccion");
  });

  it("items DONE/POSTPONED/IGNORED nunca estan at risk", () => {
    for (const status of ["DONE", "POSTPONED", "IGNORED"] as const) {
      const result = computeRisk(baseItem({ due_date: "2026-08-01", status }), TODAY);
      expect(result.isAtRisk).toBe(false);
    }
  });

  it("DELEGATED vencido si esta at risk", () => {
    const result = computeRisk(baseItem({ status: "DELEGATED", expected_date: "2026-08-01", waiting_for_what: "Revision" }), TODAY);
    expect(result.isAtRisk).toBe(true);
  });
});
