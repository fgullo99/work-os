import { describe, expect, it } from "vitest";
import { getCaseBoardData } from "./board";
import type { CaseRow } from "@/lib/supabase/types";

const TODAY = "2026-08-13";

function caseRow(overrides: Partial<CaseRow> = {}): CaseRow {
  return {
    id: overrides.id ?? "case-1",
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

/** Fake minimo: getCaseBoardData solo hace un select("*").neq("current_state","CLOSED"). */
function fakeSupabase(rows: CaseRow[]) {
  return {
    from(_table: string) {
      const api = {
        select() {
          return api;
        },
        neq(col: string, val: unknown) {
          const filtered = rows.filter((r) => (r as unknown as Record<string, unknown>)[col] !== val);
          return { then: (resolve: any) => resolve({ data: filtered, error: null }) };
        },
      };
      return api;
    },
  } as any;
}

describe("getCaseBoardData — risk como dimension independiente de current_state", () => {
  it("WAITING_EXTERNAL + AT_RISK: aparece en la columna ESPERANDO y en atRiskCases, KPI=1", async () => {
    const c = caseRow({ id: "c1", current_state: "WAITING_EXTERNAL", risk: "AT_RISK" });
    const board = await getCaseBoardData(fakeSupabase([c]), TODAY);

    expect(board.kanban.waitingExternal.map((x) => x.id)).toContain("c1");
    expect(board.atRiskCases.map((x) => x.id)).toContain("c1");
    expect(board.counts.enRiesgo).toBe(1);
    expect(board.counts.enRiesgo).toBe(board.atRiskCases.length);
  });

  it("ACTION_ME + AT_RISK: aparece en ACCIÓN MÍA y en atRiskCases", async () => {
    const c = caseRow({ id: "c2", current_state: "ACTION_ME", felipe_action_required: true, risk: "AT_RISK" });
    const board = await getCaseBoardData(fakeSupabase([c]), TODAY);

    expect(board.kanban.actionMe.map((x) => x.id)).toContain("c2");
    expect(board.atRiskCases.map((x) => x.id)).toContain("c2");
  });

  it("WAITING_EXTERNAL + NORMAL: aparece solo en su columna, nunca en atRiskCases", async () => {
    const c = caseRow({ id: "c3", current_state: "WAITING_EXTERNAL", risk: "NORMAL" });
    const board = await getCaseBoardData(fakeSupabase([c]), TODAY);

    expect(board.kanban.waitingExternal.map((x) => x.id)).toContain("c3");
    expect(board.atRiskCases.map((x) => x.id)).not.toContain("c3");
    expect(board.counts.enRiesgo).toBe(0);
  });

  it("el Kanban ya no tiene columna 'blocked' — BLOCKED no rompe ninguna columna existente", async () => {
    const c = caseRow({ id: "c4", current_state: "BLOCKED" });
    const board = await getCaseBoardData(fakeSupabase([c]), TODAY);

    expect(board.kanban).not.toHaveProperty("blocked");
    expect(board.kanban.actionMe.map((x) => x.id)).not.toContain("c4");
    expect(board.kanban.waitingExternal.map((x) => x.id)).not.toContain("c4");
    expect(board.kanban.delegatedInternal.map((x) => x.id)).not.toContain("c4");
  });

  it("orden de atRiskCases: deadline vencida primero, luego someone waiting/blocked, luego fecha proxima, luego antiguedad", async () => {
    const overdueDeadline = caseRow({ id: "overdue-deadline", current_state: "ACTION_ME", due_date: "2026-08-01", risk: "AT_RISK" });
    const waitingOverdue = caseRow({
      id: "waiting-overdue",
      current_state: "WAITING_EXTERNAL",
      expected_date: "2026-08-05",
      risk: "AT_RISK",
    });
    const nearestDate = caseRow({ id: "nearest-date", current_state: "ACTION_ME", due_date: "2026-08-20", risk: "AT_RISK" });
    const onlyAntiguedad = caseRow({ id: "solo-antiguo", current_state: "ACTION_ME", last_activity_at: "2026-06-01", risk: "AT_RISK" });

    const board = await getCaseBoardData(
      fakeSupabase([onlyAntiguedad, nearestDate, waitingOverdue, overdueDeadline]),
      TODAY
    );

    expect(board.atRiskCases.map((c) => c.id)).toEqual(["overdue-deadline", "waiting-overdue", "nearest-date", "solo-antiguo"]);
  });

  it("CLOSED/NO_ACTION nunca entran en atRiskCases aunque risk=AT_RISK", async () => {
    const noAction = caseRow({ id: "c5", current_state: "NO_ACTION", risk: "AT_RISK" });
    const board = await getCaseBoardData(fakeSupabase([noAction]), TODAY);
    expect(board.atRiskCases).toHaveLength(0);
    expect(board.counts.enRiesgo).toBe(0);
  });
});
