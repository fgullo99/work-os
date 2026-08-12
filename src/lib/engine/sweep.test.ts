import { describe, expect, it } from "vitest";
import { computeSweep } from "./sweep";
import type { WorkItemRow } from "@/lib/supabase/types";

const TODAY = "2026-08-12";

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
    last_reconciled_at: null,
    last_reconciled_thread_version: null,
    ...overrides,
  };
}

describe("computeSweep", () => {
  it("item activo sin actividad hace menos de 15 dias no aparece como stale", () => {
    const result = computeSweep([baseItem({ last_activity_at: "2026-08-01" })], TODAY);
    expect(result.staleItems).toHaveLength(0);
  });

  it("item activo sin actividad hace 15+ dias aparece como stale, con dias calculados", () => {
    const result = computeSweep([baseItem({ id: "stale-1", title: "Pedido viejo", last_activity_at: "2026-07-20" })], TODAY);
    expect(result.staleItems).toHaveLength(1);
    expect(result.staleItems[0]).toEqual({ id: "stale-1", title: "Pedido viejo", daysSinceActivity: 23 });
  });

  it("ordena los stale por mas viejo primero", () => {
    const result = computeSweep(
      [
        baseItem({ id: "a", last_activity_at: "2026-07-25" }),
        baseItem({ id: "b", last_activity_at: "2026-07-01" }),
      ],
      TODAY
    );
    expect(result.staleItems.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("items DONE/POSTPONED/IGNORED nunca cuentan como stale, sin importar last_activity_at", () => {
    for (const status of ["DONE", "POSTPONED", "IGNORED"] as const) {
      const result = computeSweep([baseItem({ status, last_activity_at: "2026-01-01" })], TODAY);
      expect(result.staleItems).toHaveLength(0);
    }
  });

  it("cuenta someone_waiting: next_action pendiente + ultimo mensaje INBOUND", () => {
    const result = computeSweep(
      [
        baseItem({ id: "a", next_action: "Responder", last_message_direction: "INBOUND" }),
        baseItem({ id: "b", next_action: "Responder", last_message_direction: "OUTBOUND" }),
        baseItem({ id: "c", next_action: null, last_message_direction: "INBOUND" }),
      ],
      TODAY
    );
    expect(result.someoneWaitingCount).toBe(1);
  });
});
