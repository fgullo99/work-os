import { describe, expect, it, vi } from "vitest";
import { runCatchupBatch, manualRequeueFailedThread, CatchupLockError, CATCHUP_LOCK_TTL_MS } from "./catchup";
import type { GoogleConnectionRow } from "@/lib/supabase/types";
import type { AIProvider, AiUsage, EmailThreadResult } from "@/lib/ai";

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
    case_history_id: null,
    last_case_synced_at: null,
    last_case_sync_summary: null,
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

describe("lock server-side contra doble worker", () => {
  it("una segunda ejecucion mientras el lock esta activo (reciente) tira CatchupLockError", async () => {
    const threadIds = ["t-0", "t-1"];
    gmailRef.current = makeFakeGmail(threadIds);
    providerRef.current = { normalizeEmailThread: async () => defaultEmailResult({}) } as unknown as AIProvider;

    const supabase = makeFakeSupabase({
      gmail_catchup_state: [
        {
          connection_id: "conn-1",
          status: "in_progress",
          thread_queue: threadIds,
          cursor_index: 0,
          processed_count: 0,
          auto_created_count: 0,
          auto_updated_count: 0,
          delegated_count: 0,
          waiting_count: 0,
          no_op_count: 0,
          review_count: 0,
          ignored_count: 0,
          rule_filtered_count: 0,
          failed_count: 0,
          failed_threads: [],
          permanently_failed_threads: [],
          target_history_id: "h100",
          worker_locked_at: new Date().toISOString(),
          worker_id: "otro-worker",
          ai_calls_count: 0,
          ai_input_tokens: 0,
          ai_output_tokens: 0,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null,
        },
      ],
      google_connection: [connection() as unknown as Row],
    });

    await expect(runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 })).rejects.toThrow(CatchupLockError);
  });

  it("un lock viejo (mas de CATCHUP_LOCK_TTL_MS) se considera expirado y no bloquea", async () => {
    const threadIds = ["t-0", "t-1"];
    gmailRef.current = makeFakeGmail(threadIds);
    providerRef.current = { normalizeEmailThread: async () => defaultEmailResult({}) } as unknown as AIProvider;

    const staleLockAt = new Date(Date.now() - CATCHUP_LOCK_TTL_MS - 5_000).toISOString();
    const supabase = makeFakeSupabase({
      gmail_catchup_state: [
        {
          connection_id: "conn-1",
          status: "in_progress",
          thread_queue: threadIds,
          cursor_index: 0,
          processed_count: 0,
          auto_created_count: 0,
          auto_updated_count: 0,
          delegated_count: 0,
          waiting_count: 0,
          no_op_count: 0,
          review_count: 0,
          ignored_count: 0,
          rule_filtered_count: 0,
          failed_count: 0,
          failed_threads: [],
          permanently_failed_threads: [],
          target_history_id: "h100",
          worker_locked_at: staleLockAt,
          worker_id: "worker-que-murio",
          ai_calls_count: 0,
          ai_input_tokens: 0,
          ai_output_tokens: 0,
          started_at: staleLockAt,
          updated_at: staleLockAt,
          completed_at: null,
        },
      ],
      google_connection: [connection() as unknown as Row],
    });

    const result = await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });
    expect(result.status).toBe("completed");

    const state = supabase.tables.gmail_catchup_state![0]!;
    // el lock se libera al terminar — nunca queda tomado para siempre.
    expect(state.worker_locked_at).toBeNull();
    expect(state.worker_id).toBeNull();
  });

  it("el lock se libera incluso si el batch termina en el early-return de cola vacia", async () => {
    gmailRef.current = makeFakeGmail([]);
    providerRef.current = { normalizeEmailThread: async () => defaultEmailResult({}) } as unknown as AIProvider;

    const supabase = makeFakeSupabase({ gmail_catchup_state: [], google_connection: [connection() as unknown as Row] });
    await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });

    const state = supabase.tables.gmail_catchup_state![0]!;
    expect(state.worker_locked_at).toBeNull();
    expect(state.worker_id).toBeNull();
  });
});

describe("manualRequeueFailedThread — recuperar threads fallidos antes de que existiera failed_threads", () => {
  it("agrega el thread a failed_threads con attempts=0 para que el proximo lote lo reintente primero", async () => {
    const supabase = makeFakeSupabase({
      gmail_catchup_state: [
        {
          connection_id: "conn-1",
          status: "in_progress",
          thread_queue: ["t-a", "t-b"],
          cursor_index: 2,
          processed_count: 2,
          auto_created_count: 0,
          auto_updated_count: 0,
          delegated_count: 0,
          waiting_count: 0,
          no_op_count: 0,
          review_count: 0,
          ignored_count: 0,
          rule_filtered_count: 0,
          failed_count: 2,
          failed_threads: [],
          permanently_failed_threads: [],
          target_history_id: "h1",
          worker_locked_at: null,
          worker_id: null,
          ai_calls_count: 0,
          ai_input_tokens: 0,
          ai_output_tokens: 0,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null,
        },
      ],
    });

    await manualRequeueFailedThread(supabase as any, "conn-1", "19ff6b03c397a27d", "ZodError attention_owner Required (bug historico, ya corregido)");
    await manualRequeueFailedThread(supabase as any, "conn-1", "19ff6a4988250a14", "ZodError attention_owner Required (bug historico, ya corregido)");

    const state = supabase.tables.gmail_catchup_state![0]!;
    const failed = state.failed_threads as Array<{ threadId: string; attempts: number }>;
    expect(failed.map((f) => f.threadId).sort()).toEqual(["19ff6a4988250a14", "19ff6b03c397a27d"].sort());
    expect(failed.every((f) => f.attempts === 0)).toBe(true);
  });

  it("es idempotente: requeue dos veces el mismo threadId no lo duplica", async () => {
    const supabase = makeFakeSupabase({
      gmail_catchup_state: [
        {
          connection_id: "conn-1",
          status: "in_progress",
          thread_queue: [],
          cursor_index: 0,
          processed_count: 0,
          auto_created_count: 0,
          auto_updated_count: 0,
          delegated_count: 0,
          waiting_count: 0,
          no_op_count: 0,
          review_count: 0,
          ignored_count: 0,
          rule_filtered_count: 0,
          failed_count: 0,
          failed_threads: [],
          permanently_failed_threads: [],
          target_history_id: null,
          worker_locked_at: null,
          worker_id: null,
          ai_calls_count: 0,
          ai_input_tokens: 0,
          ai_output_tokens: 0,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null,
        },
      ],
    });

    await manualRequeueFailedThread(supabase as any, "conn-1", "t-dup", "nota");
    await manualRequeueFailedThread(supabase as any, "conn-1", "t-dup", "nota");

    const state = supabase.tables.gmail_catchup_state![0]!;
    expect((state.failed_threads as unknown[]).length).toBe(1);
  });

  it("si el thread estaba en permanently_failed_threads, el requeue lo saca de ahi y lo vuelve a poner en failed_threads", async () => {
    const supabase = makeFakeSupabase({
      gmail_catchup_state: [
        {
          connection_id: "conn-1",
          status: "in_progress",
          thread_queue: [],
          cursor_index: 0,
          processed_count: 0,
          auto_created_count: 0,
          auto_updated_count: 0,
          delegated_count: 0,
          waiting_count: 0,
          no_op_count: 0,
          review_count: 0,
          ignored_count: 0,
          rule_filtered_count: 0,
          failed_count: 0,
          failed_threads: [],
          permanently_failed_threads: [
            { threadId: "t-perm", attempts: 3, lastErrorClass: "AINormalizationError", firstFailedAt: "2026-08-01T00:00:00.000Z", lastFailedAt: "2026-08-01T00:00:00.000Z" },
          ],
          target_history_id: null,
          worker_locked_at: null,
          worker_id: null,
          ai_calls_count: 0,
          ai_input_tokens: 0,
          ai_output_tokens: 0,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null,
        },
      ],
    });

    await manualRequeueFailedThread(supabase as any, "conn-1", "t-perm", "reintento manual explicito");

    const state = supabase.tables.gmail_catchup_state![0]!;
    expect((state.permanently_failed_threads as unknown[]).length).toBe(0);
    const failed = state.failed_threads as Array<{ threadId: string; attempts: number }>;
    expect(failed).toEqual([expect.objectContaining({ threadId: "t-perm", attempts: 0 })]);
  });

  it("tira si no existe gmail_catchup_state para esa conexion (no inventa un requeue a ciegas)", async () => {
    const supabase = makeFakeSupabase({ gmail_catchup_state: [] });
    await expect(manualRequeueFailedThread(supabase as any, "conn-inexistente", "t-x", "nota")).rejects.toThrow();
  });
});

describe("telemetria de costo (AI calls / tokens) — opcional, no afecta el resultado", () => {
  it("agrega las llamadas y tokens reportados por el provider a thisBatch.aiUsage y total.aiUsage, y los persiste", async () => {
    const threadIds = ["t-0", "t-1"];
    gmailRef.current = makeFakeGmail(threadIds);
    providerRef.current = {
      normalizeEmailThread: async (_input: any, onUsage?: (usage: AiUsage) => void) => {
        onUsage?.({ inputTokens: 1000, outputTokens: 200 });
        return defaultEmailResult({});
      },
    } as unknown as AIProvider;

    const supabase = makeFakeSupabase({ gmail_catchup_state: [], google_connection: [connection() as unknown as Row] });
    const result = await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });

    expect(result.thisBatch.aiUsage).toEqual({ calls: 2, inputTokens: 2000, outputTokens: 400 });
    expect(result.total.aiUsage).toEqual({ calls: 2, inputTokens: 2000, outputTokens: 400 });
    expect(typeof result.thisBatch.durationMs).toBe("number");

    const state = supabase.tables.gmail_catchup_state![0]!;
    expect(state.ai_calls_count).toBe(2);
    expect(state.ai_input_tokens).toBe(2000);
    expect(state.ai_output_tokens).toBe(400);
  });

  it("un provider que nunca llama a onUsage (fake generico) deja aiUsage en cero sin romper nada", async () => {
    const threadIds = ["t-0"];
    gmailRef.current = makeFakeGmail(threadIds);
    providerRef.current = { normalizeEmailThread: async () => defaultEmailResult({}) } as unknown as AIProvider;

    const supabase = makeFakeSupabase({ gmail_catchup_state: [], google_connection: [connection() as unknown as Row] });
    const result = await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });

    expect(result.thisBatch.aiUsage).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0 });
  });
});

describe("processed/pending — unica fuente de verdad (suma de buckets de resultado, nunca cursor_index ni un contador acumulado)", () => {
  it("415 total, 45 unique processed (suma de los 6 buckets) -> pending 370", async () => {
    gmailRef.current = makeFakeGmail([]);
    providerRef.current = { normalizeEmailThread: async () => defaultEmailResult({}) } as unknown as AIProvider;

    const threadQueue = Array.from({ length: 415 }, (_, i) => `t-${i}`);
    const supabase = makeFakeSupabase({
      gmail_catchup_state: [
        {
          connection_id: "conn-1",
          status: "in_progress",
          thread_queue: threadQueue,
          cursor_index: 415, // la cola principal ya se recorrio entera
          processed_count: 999, // valor deliberadamente "sucio" — nunca deberia usarse tal cual
          auto_created_count: 10,
          auto_updated_count: 5,
          delegated_count: 0,
          waiting_count: 0,
          no_op_count: 10,
          review_count: 10,
          ignored_count: 5,
          rule_filtered_count: 5, // 10+5+10+10+5+5 = 45
          failed_count: 3,
          failed_threads: [],
          permanently_failed_threads: [],
          target_history_id: "h1",
          worker_locked_at: null,
          worker_id: null,
          ai_calls_count: 0,
          ai_input_tokens: 0,
          ai_output_tokens: 0,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null,
        },
      ],
      google_connection: [connection() as unknown as Row],
    });

    const result = await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });

    expect(result.total.queueLength).toBe(415);
    expect(result.total.threadsProcessed).toBe(45); // recalculado desde los buckets, no el 999 sucio
    expect(result.total.pending).toBe(370); // 415 - 45 - 0 permanentes
  });

  it("un thread que falla dos veces y luego tiene exito cuenta processed +1, nunca +3", async () => {
    const threadIds = ["t-flaky"];
    gmailRef.current = makeFakeGmail(threadIds);
    let attempt = 0;
    providerRef.current = {
      normalizeEmailThread: async () => {
        attempt += 1;
        if (attempt <= 2) throw new Error("falla transitoria");
        return defaultEmailResult({});
      },
    } as unknown as AIProvider;

    const supabase = makeFakeSupabase({ gmail_catchup_state: [], google_connection: [connection() as unknown as Row] });

    const r1 = await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 }); // falla 1
    expect(r1.total.threadsProcessed).toBe(0);
    const r2 = await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 }); // falla 2
    expect(r2.total.threadsProcessed).toBe(0);
    const r3 = await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 }); // exito
    expect(r3.status).toBe("completed");
    expect(r3.total.threadsProcessed).toBe(1); // +1, nunca +3 por los 2 intentos previos
    expect(r3.total.pending).toBe(0);
  });

  it("un thread rule-filtered cuenta como processed (+1) sin pasar por la IA", async () => {
    const threadId = "t-newsletter";
    gmailRef.current = {
      users: {
        threads: {
          list: async () => ({ data: { threads: [{ id: threadId }], nextPageToken: undefined } }),
          get: async () => ({
            data: {
              id: threadId,
              historyId: "h1",
              messages: [
                {
                  id: "m1",
                  internalDate: String(Date.now()),
                  snippet: "newsletter",
                  payload: {
                    headers: [
                      { name: "From", value: "newsletter@ejemplo.com" },
                      { name: "To", value: "me@tmc.com" },
                      { name: "Subject", value: "Newsletter semanal" },
                      { name: "List-Unsubscribe", value: "<mailto:baja@ejemplo.com>" },
                    ],
                    mimeType: "text/plain",
                    body: { data: Buffer.from("contenido de newsletter", "utf-8").toString("base64url") },
                  },
                },
              ],
            },
          }),
        },
        getProfile: async () => ({ data: { historyId: "h1" } }),
      },
    };
    let aiCalled = false;
    providerRef.current = {
      normalizeEmailThread: async () => {
        aiCalled = true;
        return defaultEmailResult({});
      },
    } as unknown as AIProvider;

    const supabase = makeFakeSupabase({ gmail_catchup_state: [], google_connection: [connection() as unknown as Row] });
    const result = await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });

    expect(aiCalled).toBe(false); // el rule filter corta antes de llegar a la IA
    expect(result.total.threadsProcessed).toBe(1); // rule-filtered SI cuenta como processed
    expect(result.total.pending).toBe(0);

    const state = supabase.tables.gmail_catchup_state![0]!;
    expect(state.rule_filtered_count).toBe(1);
  });

  it("un thread retryable sin resolver todavia sigue contando como pending, no como processed", async () => {
    const threadIds = ["t-ok", "t-stuck"];
    gmailRef.current = makeFakeGmail(threadIds);
    providerRef.current = {
      normalizeEmailThread: async ({ thread }: any) => {
        if (thread.threadId === "t-stuck") throw new Error("sigue fallando");
        return defaultEmailResult({});
      },
    } as unknown as AIProvider;

    const supabase = makeFakeSupabase({ gmail_catchup_state: [], google_connection: [connection() as unknown as Row] });
    const result = await runCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });

    expect(result.status).toBe("in_progress");
    expect(result.retryableFailedCount).toBe(1); // t-stuck sigue en la cola de reintento
    expect(result.total.threadsProcessed).toBe(1); // solo t-ok tiene resultado final
    expect(result.total.pending).toBe(1); // t-stuck: ni processed ni permanentemente fallido -> pending
  });
});
