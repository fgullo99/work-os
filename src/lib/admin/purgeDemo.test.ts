import { describe, expect, it } from "vitest";
import { purgeDemoData } from "./purgeDemo";

interface LogEntry {
  table: string;
  op: string;
  col?: string;
  val?: unknown;
}

/** Fake minimo de un query builder de supabase-js: solo implementa lo que purgeDemoData
 * usa (select/delete + eq/in), y registra cada filtro aplicado para poder afirmar que
 * TODO borrado pasa por `.eq("is_demo", true)` (o `.in("work_item_id", <ids de work items
 * demo>)` para notes) — nunca un borrado sin filtro ni con is_demo=false. */
function makeFakeSupabase(demoWorkItemIds: string[]) {
  const log: LogEntry[] = [];

  const countByTable: Record<string, number> = {
    review_item: 2,
    source_link: 3,
    note: 1,
    work_item: demoWorkItemIds.length,
    contact: 2,
    context: 2,
    company: 1,
  };

  function from(table: string) {
    let op: "select" | "delete" = "select";
    return {
      select(_cols: string) {
        op = "select";
        return this;
      },
      delete(_opts?: { count?: string }) {
        op = "delete";
        return this;
      },
      eq(col: string, val: unknown) {
        log.push({ table, op, col, val });
        if (op === "select") {
          return Promise.resolve({ data: demoWorkItemIds.map((id) => ({ id })), error: null });
        }
        return Promise.resolve({ count: countByTable[table] ?? 0, error: null });
      },
      in(col: string, vals: unknown[]) {
        log.push({ table, op, col, val: vals });
        return Promise.resolve({ count: countByTable[table] ?? 0, error: null });
      },
    };
  }

  return { client: { from } as unknown as Parameters<typeof purgeDemoData>[0], log };
}

describe("purgeDemoData", () => {
  it("filters every delete by is_demo=true (never unfiltered, never is_demo=false)", async () => {
    const { client, log } = makeFakeSupabase(["wi-1", "wi-2"]);
    await purgeDemoData(client);

    const deletes = log.filter((entry) => entry.op === "delete");
    expect(deletes.length).toBeGreaterThan(0);
    for (const entry of deletes) {
      if (entry.table === "note") {
        // notes no tienen is_demo propio: se borran por pertenecer a un work_item demo,
        // cuyos ids salieron de un select previo filtrado por is_demo=true.
        expect(entry.col).toBe("work_item_id");
        expect(entry.val).toEqual(["wi-1", "wi-2"]);
      } else {
        expect(entry.col).toBe("is_demo");
        expect(entry.val).toBe(true);
      }
    }
  });

  it("looks up demo work item ids via is_demo=true before touching notes", async () => {
    const { client, log } = makeFakeSupabase(["wi-1"]);
    await purgeDemoData(client);
    const workItemSelect = log.find((entry) => entry.table === "work_item" && entry.op === "select");
    expect(workItemSelect).toEqual({ table: "work_item", op: "select", col: "is_demo", val: true });
  });

  it("skips the notes delete entirely when there are no demo work items", async () => {
    const { client, log } = makeFakeSupabase([]);
    await purgeDemoData(client);
    expect(log.some((entry) => entry.table === "note")).toBe(false);
  });

  it("returns the counts reported by each delete", async () => {
    const { client } = makeFakeSupabase(["wi-1", "wi-2"]);
    const result = await purgeDemoData(client);
    expect(result).toEqual({
      reviewItems: 2,
      sourceLinks: 3,
      notes: 1,
      workItems: 2,
      contacts: 2,
      contexts: 2,
      companies: 1,
    });
  });
});
