import { describe, expect, it } from "vitest";
import { computePriority } from "./priority";
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

describe("computePriority", () => {
  it("DO_NOW cuando esta vencido", () => {
    const result = computePriority(baseItem({ due_date: "2026-08-09" }), { todayISO: TODAY, contactTier: "B" });
    expect(result.bucket).toBe("DO_NOW");
    expect(result.why).toContain("Vencido");
  });

  it("suma tier A + vence hoy y da DO_NOW con why combinado", () => {
    const result = computePriority(baseItem({ due_date: TODAY }), { todayISO: TODAY, contactTier: "A" });
    // 80 (hoy) + 20 (tier A) = 100
    expect(result.score).toBe(100);
    expect(result.bucket).toBe("DO_NOW");
    expect(result.why).toBe("Vence hoy + Cliente Tier A.");
  });

  it("blocking + waiting overdue quedan reflejados en el why", () => {
    const result = computePriority(
      baseItem({ waiting_for_what: "Planos", expected_date: "2026-08-07", blocking: true, blocking_note: "produccion" }),
      { todayISO: TODAY, contactTier: "C" }
    );
    // 30 (waiting overdue) + 25 (blocking) = 55 -> TODAY
    expect(result.bucket).toBe("TODAY");
    expect(result.why).toContain("bloquea produccion");
  });

  it("sin ninguna senal cae en CAN_WAIT", () => {
    const result = computePriority(baseItem(), { todayISO: TODAY, contactTier: "C" });
    expect(result.bucket).toBe("CAN_WAIT");
    expect(result.why).toBe("Sin urgencia detectada.");
  });

  it("someone_waiting: next_action pendiente + ultimo mensaje INBOUND suma 30 y aparece en el why", () => {
    const result = computePriority(baseItem({ next_action: "Responder", last_message_direction: "INBOUND" }), {
      todayISO: TODAY,
      contactTier: "C",
    });
    expect(result.score).toBe(30);
    expect(result.bucket).toBe("THIS_WEEK");
    expect(result.why.toLowerCase()).toContain("respuesta pendiente");
  });

  it("someone_waiting NO se activa si el ultimo mensaje fue OUTBOUND (ya respondimos)", () => {
    const result = computePriority(baseItem({ next_action: "Responder", last_message_direction: "OUTBOUND" }), {
      todayISO: TODAY,
      contactTier: "C",
    });
    expect(result.score).toBe(0);
  });

  it("someone_waiting NO se activa sin next_action, aunque el ultimo mensaje sea INBOUND", () => {
    const result = computePriority(baseItem({ next_action: null, last_message_direction: "INBOUND" }), {
      todayISO: TODAY,
      contactTier: "C",
    });
    expect(result.score).toBe(0);
  });
});
