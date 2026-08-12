import { describe, expect, it } from "vitest";
import { undoAiAction } from "./undo";

type Row = Record<string, unknown>;

/** Fake minimo, suficiente para los call-patterns de undo.ts: ai_action_log/work_item por
 * id (maybeSingle), update por id, insert en note. No es un emulador general de Postgrest. */
function makeFakeSupabase(seed: { ai_action_log?: Row[]; work_item?: Row[] }) {
  const tables: Record<string, Row[]> = {
    ai_action_log: seed.ai_action_log ?? [],
    work_item: seed.work_item ?? [],
    note: [],
  };

  function from(table: string) {
    let type: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row = {};
    const filters: Array<[string, unknown]> = [];

    const api: any = {
      select() {
        return api;
      },
      insert(p: Row) {
        type = "insert";
        payload = p;
        return api;
      },
      update(p: Row) {
        type = "update";
        payload = p;
        return api;
      },
      delete() {
        type = "delete";
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return api;
      },
      maybeSingle() {
        return resolve(true);
      },
      single() {
        return resolve(true);
      },
      then(onFulfilled: any, onRejected: any) {
        return resolve(false).then(onFulfilled, onRejected);
      },
    };

    function matchesFilters(row: Row): boolean {
      return filters.every(([col, val]) => row[col] === val);
    }

    function resolve(wantsSingle: boolean): Promise<{ data: unknown; error: null }> {
      if (type === "insert") {
        const row: Row = { id: `${table}-${Object.keys(tables).length}-${tables[table]!.length + 1}`, ...payload };
        tables[table] = [...(tables[table] ?? []), row];
        return Promise.resolve({ data: wantsSingle ? row : [row], error: null });
      }
      if (type === "update") {
        tables[table] = (tables[table] ?? []).map((row) => (matchesFilters(row) ? { ...row, ...payload } : row));
        return Promise.resolve({ data: null, error: null });
      }
      if (type === "delete") {
        tables[table] = (tables[table] ?? []).filter((row) => !matchesFilters(row));
        return Promise.resolve({ data: null, error: null });
      }
      const rows = (tables[table] ?? []).filter(matchesFilters);
      return Promise.resolve({ data: wantsSingle ? rows[0] ?? null : rows, error: null });
    }

    return api;
  }

  return { from, tables };
}

const NOW = "2026-08-10T12:00:00.000Z";
const SOON_AFTER = "2026-08-10T12:00:02.000Z"; // dentro de la tolerancia (< 5s)
const MUCH_LATER = "2026-08-10T12:05:00.000Z"; // fuera de la tolerancia

describe("undoAiAction", () => {
  it("returns not_found when the log id does not exist", async () => {
    const supabase = makeFakeSupabase({});
    const result = await undoAiAction(supabase as any, "missing");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns already_undone when the log was already reverted", async () => {
    const supabase = makeFakeSupabase({
      ai_action_log: [{ id: "log-1", action: "CREATE", work_item_id: "wi-1", created_at: NOW, undone_at: NOW }],
    });
    const result = await undoAiAction(supabase as any, "log-1");
    expect(result).toEqual({ ok: false, reason: "already_undone" });
  });

  it("CREATE undo deletes the work_item when there was no human activity since", async () => {
    const supabase = makeFakeSupabase({
      ai_action_log: [{ id: "log-1", action: "CREATE", work_item_id: "wi-1", created_at: NOW, undone_at: null }],
      work_item: [{ id: "wi-1", title: "Item", last_activity_at: SOON_AFTER }],
    });
    const result = await undoAiAction(supabase as any, "log-1");
    expect(result).toEqual({ ok: true, kind: "deleted" });
    expect(supabase.tables.work_item).toHaveLength(0);
    expect(supabase.tables.ai_action_log![0]?.undone_at).not.toBeNull();
  });

  it("CREATE undo refuses to delete when there was human activity since (last_activity_at drifted)", async () => {
    const supabase = makeFakeSupabase({
      ai_action_log: [{ id: "log-1", action: "CREATE", work_item_id: "wi-1", created_at: NOW, undone_at: null }],
      work_item: [{ id: "wi-1", title: "Item", last_activity_at: MUCH_LATER }],
    });
    const result = await undoAiAction(supabase as any, "log-1");
    expect(result).toEqual({ ok: false, reason: "human_activity_since" });
    expect(supabase.tables.work_item).toHaveLength(1);
    expect(supabase.tables.note).toHaveLength(1);
  });

  it("UPDATE undo reverts unconflicted fields to before_values", async () => {
    const supabase = makeFakeSupabase({
      ai_action_log: [
        {
          id: "log-1",
          action: "UPDATE",
          work_item_id: "wi-1",
          created_at: NOW,
          undone_at: null,
          changed_fields: ["next_action", "due_date"],
          before_values: { next_action: null, due_date: null },
          after_values: { next_action: "Mandar precio", due_date: "2026-08-12" },
        },
      ],
      work_item: [{ id: "wi-1", next_action: "Mandar precio", due_date: "2026-08-12", last_activity_at: SOON_AFTER }],
    });
    const result = await undoAiAction(supabase as any, "log-1");
    expect(result).toEqual({ ok: true, kind: "reverted", revertedFields: ["next_action", "due_date"], conflictFields: [] });
    const updated = supabase.tables.work_item![0];
    expect(updated?.next_action).toBeNull();
    expect(updated?.due_date).toBeNull();
  });

  it("UPDATE undo does NOT overwrite a field the user already changed again — reports it as a conflict", async () => {
    const supabase = makeFakeSupabase({
      ai_action_log: [
        {
          id: "log-1",
          action: "UPDATE",
          work_item_id: "wi-1",
          created_at: NOW,
          undone_at: null,
          changed_fields: ["next_action"],
          before_values: { next_action: null },
          after_values: { next_action: "Mandar precio (AI)" },
        },
      ],
      // El usuario ya lo edito de nuevo despues de la accion automatica.
      work_item: [{ id: "wi-1", next_action: "Mandar precio (editado por Felipe)", last_activity_at: SOON_AFTER }],
    });
    const result = await undoAiAction(supabase as any, "log-1");
    expect(result).toEqual({ ok: true, kind: "reverted", revertedFields: [], conflictFields: ["next_action"] });
    const updated = supabase.tables.work_item![0];
    expect(updated?.next_action).toBe("Mandar precio (editado por Felipe)");
  });
});
