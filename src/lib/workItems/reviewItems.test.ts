import { describe, expect, it } from "vitest";
import { setReviewFeedback } from "./reviewItems";

type Row = Record<string, unknown>;

/** Fake minimo, suficiente para el call-pattern de setReviewFeedback: update+eq sobre
 * review_item. Mismo estilo que src/lib/engine/undo.test.ts. */
function makeFakeSupabase(seed: { review_item?: Row[] }) {
  const tables: Record<string, Row[]> = { review_item: seed.review_item ?? [] };

  function from(table: string) {
    let payload: Row = {};
    const filters: Array<[string, unknown]> = [];

    const api: any = {
      update(p: Row) {
        payload = p;
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return api;
      },
      then(onFulfilled: any, onRejected: any) {
        const matches = (row: Row) => filters.every(([col, val]) => row[col] === val);
        tables[table] = (tables[table] ?? []).map((row) => (matches(row) ? { ...row, ...payload } : row));
        return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  return { from, tables };
}

describe("setReviewFeedback", () => {
  it("guarda el feedback y marca el review_item como IGNORED con resolved_at", async () => {
    const supabase = makeFakeSupabase({
      review_item: [{ id: "ri-1", status: "PENDING", feedback: null, resolved_at: null }],
    });

    await setReviewFeedback(supabase as any, "ri-1", "WRONG");

    const row = supabase.tables.review_item![0];
    expect(row?.feedback).toBe("WRONG");
    expect(row?.status).toBe("IGNORED");
    expect(row?.resolved_at).not.toBeNull();
  });

  it.each(["CORRECT", "WRONG", "NOT_IMPORTANT", "PERSONAL"] as const)("acepta feedback=%s", async (feedback) => {
    const supabase = makeFakeSupabase({
      review_item: [{ id: "ri-1", status: "PENDING", feedback: null, resolved_at: null }],
    });
    await setReviewFeedback(supabase as any, "ri-1", feedback);
    expect(supabase.tables.review_item![0]?.feedback).toBe(feedback);
  });

  it("solo toca el review_item cuyo id coincide", async () => {
    const supabase = makeFakeSupabase({
      review_item: [
        { id: "ri-1", status: "PENDING", feedback: null },
        { id: "ri-2", status: "PENDING", feedback: null },
      ],
    });
    await setReviewFeedback(supabase as any, "ri-1", "PERSONAL");
    expect(supabase.tables.review_item![0]?.feedback).toBe("PERSONAL");
    expect(supabase.tables.review_item![1]?.feedback).toBeNull();
  });
});
