import { describe, expect, it, vi } from "vitest";
import { runCaseCatchupBatch, classifyCaseThreadOutcome, CatchupLockError } from "./caseCatchup";
import type { GoogleConnectionRow } from "@/lib/supabase/types";
import type { AIProvider } from "@/lib/ai";
import type { CaseStateResult } from "@/lib/ai/caseSchema";

const gmailRef: { current: any } = { current: null };
const providerRef: { current: AIProvider } = { current: null as unknown as AIProvider };

vi.mock("@/lib/google/oauthClient", () => ({
  getAuthorizedGmailClient: async () => ({}),
}));
vi.mock("@/lib/ai", () => ({
  getAIProvider: () => providerRef.current,
}));
vi.mock("@/lib/gmail/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gmail/client")>();
  return { ...actual, getGmailApi: () => gmailRef.current };
});

type Row = Record<string, unknown>;

function makeFakeSupabase(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, [...v]]));

  function from(table: string) {
    let type: "select" | "insert" | "update" | "upsert" = "select";
    let payload: Row = {};
    let conflictCol: string | null = null;
    let wantsSingle = false;
    const filters: Array<{ op: "eq" | "neq"; col: string; val: unknown }> = [];

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
      neq(col: string, val: unknown) {
        filters.push({ op: "neq", col, val });
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
      return filters.every((f) => (f.op === "eq" ? row[f.col] === f.val : row[f.col] !== f.val));
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

function defaultCaseResult(overrides: Partial<CaseStateResult> = {}): CaseStateResult {
  return {
    case_title: "Cotización test",
    reference_type: null,
    reference_value: null,
    current_state: "WAITING_EXTERNAL",
    current_owner: "EXTERNAL",
    felipe_action_required: false,
    next_action: null,
    waiting_for: "Respuesta del cliente",
    responsible: null,
    due_date_phrase: null,
    expected_date_phrase: null,
    last_meaningful_event: "Oferta enviada",
    risk: "NORMAL",
    confidence: "HIGH",
    closure_evidence_unambiguous: false,
    summary: "resumen",
    ...overrides,
  };
}

function makeRawThread(threadId: string) {
  return {
    id: threadId,
    historyId: "h1",
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

function makeFakeGmail(threadIds: string[]) {
  return {
    users: {
      threads: {
        get: async ({ id, format }: { id: string; format?: string }) => {
          if (format === "full" || !format) return { data: makeRawThread(id) };
          throw new Error(`formato inesperado: ${format}`);
        },
      },
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

function gmailCatchupStateRow(overrides: Partial<Row> = {}): Row {
  return {
    connection_id: "conn-1",
    status: "in_progress",
    thread_queue: ["t-0", "t-1", "t-2", "t-3", "t-4"],
    cursor_index: 3, // t-0/t-1/t-2 ya procesados por el catch-up viejo — no deben reprocesarse
    failed_threads: [],
    permanently_failed_threads: [],
    ...overrides,
  };
}

describe("classifyCaseThreadOutcome", () => {
  it("mapea cada action al bucket correcto", () => {
    expect(classifyCaseThreadOutcome({ ruleFilterSkipped: true } as any)).toBe("RULE_FILTERED");
    expect(classifyCaseThreadOutcome({ ruleFilterSkipped: false, action: "AUTO_CREATE_CASE" } as any)).toBe("CASES_CREATED");
    expect(classifyCaseThreadOutcome({ ruleFilterSkipped: false, action: "AUTO_MERGE" } as any)).toBe("THREADS_MERGED");
    expect(classifyCaseThreadOutcome({ ruleFilterSkipped: false, action: "CASE_MERGE_REVIEW" } as any)).toBe("CASE_MERGE_REVIEW");
    expect(classifyCaseThreadOutcome({ ruleFilterSkipped: false, action: "CASE_STATE_REVIEW" } as any)).toBe("CASE_STATE_REVIEW");
  });
});

describe("runCaseCatchupBatch — siembra desde gmail_catchup_state, batch/lock/retry", () => {
  it("siembra la cola SOLO con los threads pendientes del catch-up viejo (thread_queue.slice(cursor_index)), nunca los ya procesados", async () => {
    gmailRef.current = makeFakeGmail(["t-3", "t-4"]);
    providerRef.current = { analyzeCaseState: async () => defaultCaseResult() } as unknown as AIProvider;

    const supabase = makeFakeSupabase({
      case_catchup_state: [],
      gmail_catchup_state: [gmailCatchupStateRow()],
      case: [],
      case_source_link: [],
      contact: [],
      company: [],
    });

    const result = await runCaseCatchupBatch(supabase as any, connection(), { batchSize: 10, timeBudgetMs: 60_000 });

    expect(result.status).toBe("completed");
    expect(result.total.threadsProcessed).toBe(2); // solo t-3 y t-4, nunca t-0/t-1/t-2
    const state = supabase.tables.case_catchup_state![0]!;
    expect(state.thread_queue).toEqual(["t-3", "t-4"]);
  });

  it("incluye los failed_threads retryables del catch-up viejo en la cola sembrada", async () => {
    gmailRef.current = makeFakeGmail(["t-3", "t-4", "t-old-fail"]);
    providerRef.current = { analyzeCaseState: async () => defaultCaseResult() } as unknown as AIProvider;

    const supabase = makeFakeSupabase({
      case_catchup_state: [],
      gmail_catchup_state: [
        gmailCatchupStateRow({
          failed_threads: [{ threadId: "t-old-fail", attempts: 1, lastErrorClass: "Error", firstFailedAt: "x", lastFailedAt: "x" }],
        }),
      ],
      case: [],
      case_source_link: [],
      contact: [],
      company: [],
    });

    const result = await runCaseCatchupBatch(supabase as any, connection(), { batchSize: 10, timeBudgetMs: 60_000 });
    const state = supabase.tables.case_catchup_state![0]!;
    expect(state.thread_queue as string[]).toEqual(expect.arrayContaining(["t-3", "t-4", "t-old-fail"]));
    expect(result.total.threadsProcessed).toBe(3);
  });

  it("respeta el batchSize — un lote acotado no procesa toda la cola de una", async () => {
    gmailRef.current = makeFakeGmail(["t-3", "t-4"]);
    providerRef.current = { analyzeCaseState: async () => defaultCaseResult() } as unknown as AIProvider;

    const supabase = makeFakeSupabase({
      case_catchup_state: [],
      gmail_catchup_state: [gmailCatchupStateRow()],
      case: [],
      case_source_link: [],
      contact: [],
      company: [],
    });

    const result = await runCaseCatchupBatch(supabase as any, connection(), { batchSize: 1, timeBudgetMs: 60_000 });
    expect(result.status).toBe("in_progress");
    expect(result.thisBatch.threadsProcessed).toBe(1);
    expect(result.total.pending).toBe(1);
  });

  it("un segundo lote continua desde cursor_index — nunca reprocesa lo ya hecho en ESTE catch-up", async () => {
    const processedIds: string[] = [];
    gmailRef.current = makeFakeGmail(["t-3", "t-4"]);
    const realGet = gmailRef.current.users.threads.get;
    gmailRef.current.users.threads.get = async (params: { id: string }) => {
      processedIds.push(params.id);
      return realGet(params);
    };
    providerRef.current = { analyzeCaseState: async () => defaultCaseResult() } as unknown as AIProvider;

    const supabase = makeFakeSupabase({
      case_catchup_state: [],
      gmail_catchup_state: [gmailCatchupStateRow()],
      case: [],
      case_source_link: [],
      contact: [],
      company: [],
    });

    await runCaseCatchupBatch(supabase as any, connection(), { batchSize: 1, timeBudgetMs: 60_000 });
    const result2 = await runCaseCatchupBatch(supabase as any, connection(), { batchSize: 1, timeBudgetMs: 60_000 });

    expect(result2.status).toBe("completed");
    expect(processedIds).toEqual(["t-3", "t-4"]);
  });

  it("segunda ejecucion con lock activo tira CatchupLockError", async () => {
    gmailRef.current = makeFakeGmail(["t-3", "t-4"]);
    providerRef.current = { analyzeCaseState: async () => defaultCaseResult() } as unknown as AIProvider;

    const supabase = makeFakeSupabase({
      case_catchup_state: [
        {
          connection_id: "conn-1",
          status: "in_progress",
          thread_queue: ["t-3", "t-4"],
          cursor_index: 0,
          processed_count: 0,
          cases_created_count: 0,
          threads_merged_count: 0,
          case_merge_review_count: 0,
          case_state_review_count: 0,
          no_op_count: 0,
          ignored_count: 0,
          rule_filtered_count: 0,
          failed_count: 0,
          failed_threads: [],
          permanently_failed_threads: [],
          worker_locked_at: new Date().toISOString(),
          worker_id: "otro-worker",
          ai_calls_count: 0,
          ai_input_tokens: 0,
          ai_output_tokens: 0,
          started_at: "2026-08-13T00:00:00.000Z",
          updated_at: "2026-08-13T00:00:00.000Z",
          completed_at: null,
        },
      ],
      gmail_catchup_state: [gmailCatchupStateRow()],
      case: [],
      case_source_link: [],
      contact: [],
      company: [],
    });

    await expect(runCaseCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 })).rejects.toThrow(
      CatchupLockError
    );
  });

  it("un thread que falla repetidamente se reintenta y, tras agotar los intentos, pasa a permanently_failed sin loop infinito", async () => {
    gmailRef.current = makeFakeGmail(["t-fail"]);
    providerRef.current = {
      analyzeCaseState: async () => {
        throw new Error("boom");
      },
    } as unknown as AIProvider;

    const supabase = makeFakeSupabase({
      case_catchup_state: [],
      gmail_catchup_state: [gmailCatchupStateRow({ thread_queue: ["t-0", "t-1", "t-2", "t-fail"], cursor_index: 3 })],
      case: [],
      case_source_link: [],
      contact: [],
      company: [],
    });

    const r1 = await runCaseCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });
    expect(r1.status).toBe("in_progress");
    expect(r1.retryableFailedCount).toBe(1);

    const r2 = await runCaseCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });
    expect(r2.retryableFailedCount).toBe(1);

    const r3 = await runCaseCatchupBatch(supabase as any, connection(), { batchSize: 5, timeBudgetMs: 60_000 });
    expect(r3.status).toBe("completed");
    expect(r3.retryableFailedCount).toBe(0);
    expect(r3.permanentlyFailedCount).toBe(1);
    expect(r3.total.pending).toBe(0);
  });

  it("processed + pending + permanently_failed = queueLength, siempre", async () => {
    gmailRef.current = makeFakeGmail(["t-3", "t-4"]);
    providerRef.current = { analyzeCaseState: async () => defaultCaseResult() } as unknown as AIProvider;

    const supabase = makeFakeSupabase({
      case_catchup_state: [],
      gmail_catchup_state: [gmailCatchupStateRow()],
      case: [],
      case_source_link: [],
      contact: [],
      company: [],
    });

    const result = await runCaseCatchupBatch(supabase as any, connection(), { batchSize: 1, timeBudgetMs: 60_000 });
    expect(result.total.threadsProcessed + result.total.pending + result.permanentlyFailedCount).toBe(result.total.queueLength);
  });
});
