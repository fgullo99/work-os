import { describe, expect, it, vi } from "vitest";
import { runCatchupBatch } from "./catchup";
import type { GoogleConnectionRow } from "@/lib/supabase/types";
import type { AIProvider, EmailThreadResult } from "@/lib/ai";

const gmailRef: { current: any } = { current: null };
const providerRef: { current: AIProvider } = {
  current: { normalizeEmailThread: async () => defaultEmailResult({}) } as unknown as AIProvider,
};

vi.mock("@/lib/google/oauthClient", () => ({
  getAuthorizedGmailClient: async () => ({}),
}));
vi.mock("@/lib/ai", () => ({
  getAIProvider: () => providerRef.current,
}));
vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, getGmailApi: () => gmailRef.current };
});

type Row = Record<string, unknown>;

/** Mismo fake generalizado que reconcile.test.ts, mas soporte de upsert (onConflict) que
 * catchup.ts necesita para gmail_catchup_state. */
function makeFakeSupabase(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, [...v]]));

  function from(table: string) {
    let type: "select" | "insert" | "update" | "upsert" = "select";
    let payload: Row = {};
    let conflictCol: string | null = null;
    let wantsSingle = false;
    const filters: Array<{ op: "eq"; col: string; val: unknown }> = [];

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
      upsert(p: Row, opts?: { onConflict?: string }) {
        type = "upsert";
        payload = p;
        conflictCol = opts?.onConflict ?? null;
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push({ op: "eq", col, val });
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      maybeSingle() {
        wantsSingle = true;
        return resolve();
      },
      single() {
        wantsSingle = true;
        return resolve();
      },
      then(onFulfilled: any, onRejected: any) {
        return resolve().then(onFulfilled, onRejected);
      },
    };

    function matches(row: Row): boolean {
      return filters.every((f) => row[f.col] === f.val);
    }

    async function resolve(): Promise<{ data: unknown; error: null }> {
      if (type === "insert") {
        const row: Row = { id: payload.id ?? `${table}-${(tables[table]?.length ?? 0) + 1}`, ...payload };
        tables[table] = [...(tables[table] ?? []), row];
        return { data: wantsSingle ? row : [row], error: null };
      }
      if (type === "update") {
        tables[table] = (tables[table] ?? []).map((row) => (matches(row) ? { ...row, ...payload } : row));
        const updated = (tables[table] ?? []).filter(matches);
        return { data: wantsSingle ? (updated[0] ?? null) : updated, error: null };
      }
      if (type === "upsert") {
        const col = conflictCol ?? "id";
        const idx = (tables[table] ?? []).findIndex((r) => r[col] === payload[col]);
        let row: Row;
        if (idx >= 0) {
          row = { ...tables[table]![idx], ...payload };
          tables[table]![idx] = row;
        } else {
          row = { id: payload.id ?? `${table}-${(tables[table]?.length ?? 0) + 1}`, ...payload };
          tables[table] = [...(tables[table] ?? []), row];
        }
        return { data: wantsSingle ? row : [row], error: null };
      }
      const rows = (tables[table] ?? []).filter(matches);
      return { data: wantsSingle ? (rows[0] ?? null) : rows, error: null };
    }

    return api;
  }

  return { from, tables };
}

function defaultEmailResult(overrides: Partial<EmailThreadResult>): EmailThreadResult {
  return {
    relevance: "WORK",
    classification: "INFO",
    attention_owner: "FELIPE",
    team_other_relation: null,
    next_action: null,
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
    summary: "test",
    ...overrides,
  };
}

function makeRawThread(threadId: string, historyId: string) {
  return {
    id: threadId,
    historyId,
    messages: [
      {
        id: "m1",
        internalDate: String(Date.now()),
        snippet: "hola",
        payload: {
          headers: [
            { name: "From", value: "cliente@ejemplo.com" },
            { name: "To", value: "me@tmc.com" },
            { name: "Subject", value: `Asunto ${threadId}` },
          ],
          mimeType: "text/plain",
          body: { data: Buffer.from("contenido de prueba", "utf-8").toString("base64url") },
        },
      },
    ],
  };
}

function makeFakeGmail(threadIds: string[], historyId = "h100") {
  return {
    users: {
      threads: {
        list: async () => ({ data: { threads: threadIds.map((id) => ({ id })), nextPageToken: undefined } }),
        get: async ({ id, format }: { id: string; format?: string }) => {
          if (format === "full" || !format) return { data: makeRawThread(id, historyId) };
          throw new Error(`formato inesperado en fake gmail: ${format}`);
        },
      },
      getProfile: async () => ({ data: { historyId } }),
    },
  };
}

function connection(overrides: Partial<GoogleConnectionRow> = {}): GoogleConnectionRow {
  return {
    id: "conn-1",
    email: "me@tmc.com",
    access_token: "enc",
    refresh_token: "enc",
    token_expires_at: "2026-08-12T00:00:00.000Z",
    scope: "gmail.readonly",
    history_id: "h1",
    bootstrap_completed_at: "2026-08-01T00:00:00.000Z",
    bootstrap_range_days: 7,
    last_synced_at: null,
    last_sync_summary: null,
    last_reconciliation_summary: null,
    last_reconciled_at: null,
    needs_reconnect: false,
    last_error: null,
    safe_mode: false,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("runCatchupBatch — acotado, resumible, idempotente", () => {
  it("arranca solo (auto-start) cuando no hay ningun catch-up en curso, y respeta el batchSize", async () => {
    const threadIds = Array.from({ length: 5 }, (_, i) => `t-${i}`);
    gmailRef.current = makeFakeGmail(threadIds);
    providerRef.current = { normalizeEmailThread: async () => defaultEmailResult({}) } as unknown as AIProvider;

    const supabase = makeFakeSupabase({ gmail_catchup_state: [], google_connection: [connection() as unknown as Row] });

    const result = await runCatchupBatch(supabase as any, connection(), { batchSize: 3, timeBudgetMs: 60_000 });

    expect(result.status).toBe("in_progress");
    expect(result.thisBatch.threadsProcessed).toBe(3);
    expect(result.total.pending).toBe(2);

    const state = supabase.tables.gmail_catchup_state![0]!;
    expect(state.cursor_index).toBe(3);
    expect(state.status).toBe("in_progress");
  });

  it("un segundo lote continua desde cursor_index, no reprocesa los threads ya hechos, y recien al completar actualiza el cursor incremental", async () => {
    const threadIds = Array.from({ length: 5 }, (_, i) => `t-${i}`);
    const gmail = makeFakeGmail(threadIds);
    gmailRef.current = gmail;
    providerRef.current = { normalizeEmailThread: async () => defaultEmailResult({}) } as unknown as AIProvider;

    const processedThreadIds: string[] = [];
    const realGet = gmail.users.threads.get;
    gmail.users.threads.get = async (params: { id: string; format?: string }) => {
      processedThreadIds.push(params.id);
      return realGet(params);
    };

    const supabase = makeFakeSupabase({ gmail_catchup_state: [], google_connection: [connection() as unknown as Row] });

    await runCatchupBatch(supabase as any, connection(), { batchSize: 3, timeBudgetMs: 60_000 });
    const result2 = await runCatchupBatch(supabase as any, connection(), { batchSize: 3, timeBudgetMs: 60_000 });

    expect(result2.status).toBe("completed");
    expect(result2.total.pending).toBe(0);
    expect(processedThreadIds).toEqual(["t-0", "t-1", "t-2", "t-3", "t-4"]);
    expect(new Set(processedThreadIds).size).toBe(5); // ninguno se proceso dos veces

    const conn = supabase.tables.google_connection![0]!;
    expect(conn.history_id).toBe("h100"); // cursor incremental actualizado recien al completar
  });

  it("una cola vacia (sin backlog) se completa de una, sin llamar a la IA", async () => {
    gmailRef.current = makeFakeGmail([]);
    providerRef.current = { normalizeEmailThread: async () => defaultEmailResult({}) } as unknown as AIProvider;

    const supabase = makeFakeSupabase({ gmail_catchup_state: [], google_connection: [connection() as unknown as Row] });
    const result = await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });

    expect(result.status).toBe("completed");
    expect(result.total.threadsProcessed).toBe(0);
  });

  it("un thread que falla (la IA tira error) cuenta como failed, el cursor sigue avanzando (no se cuelga), y queda en la cola de reintento — no se marca completed hasta que se resuelva", async () => {
    const threadIds = ["t-ok", "t-fail"];
    gmailRef.current = makeFakeGmail(threadIds);
    providerRef.current = {
      normalizeEmailThread: async ({ thread }: any) => {
        if (thread.threadId === "t-fail") throw new Error("boom");
        return defaultEmailResult({});
      },
    } as unknown as AIProvider;

    const supabase = makeFakeSupabase({ gmail_catchup_state: [], google_connection: [connection() as unknown as Row] });
    const result = await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });

    // el cursor ya recorrio toda la cola (no se cuelga), pero como t-fail sigue en la
    // cola de reintento, el catch-up no se da por completado todavia
    expect(result.status).toBe("in_progress");
    expect(result.thisBatch.failed).toBe(1);
    expect(result.retryableFailedCount).toBe(1);
    expect(result.permanentlyFailedCount).toBe(0);
    expect(result.total.pending).toBe(1);

    const state = supabase.tables.gmail_catchup_state![0]!;
    expect(state.cursor_index).toBe(2);
  });

  it("un thread que falla repetidamente se reintenta primero en cada lote y, tras agotar los intentos, pasa a permanently_failed sin loop infinito", async () => {
    const threadIds = ["t-fail"];
    gmailRef.current = makeFakeGmail(threadIds);
    providerRef.current = {
      normalizeEmailThread: async () => {
        throw new Error("boom");
      },
    } as unknown as AIProvider;

    const supabase = makeFakeSupabase({ gmail_catchup_state: [], google_connection: [connection() as unknown as Row] });

    const r1 = await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });
    expect(r1.status).toBe("in_progress");
    expect(r1.retryableFailedCount).toBe(1);
    expect(r1.permanentlyFailedCount).toBe(0);

    const r2 = await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });
    expect(r2.status).toBe("in_progress");
    expect(r2.retryableFailedCount).toBe(1);
    expect(r2.permanentlyFailedCount).toBe(0);

    const r3 = await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });
    // tercer intento agota MAX_RETRY_ATTEMPTS (3): se mueve a permanently_failed y,
    // al no quedar nada pendiente, el catch-up se completa (no queda colgado para siempre)
    expect(r3.status).toBe("completed");
    expect(r3.retryableFailedCount).toBe(0);
    expect(r3.permanentlyFailedCount).toBe(1);
    expect(r3.total.pending).toBe(0);

    const state = supabase.tables.gmail_catchup_state![0]!;
    expect((state.permanently_failed_threads as unknown[]).length).toBe(1);
    expect((state.failed_threads as unknown[]).length).toBe(0);
  });
});
