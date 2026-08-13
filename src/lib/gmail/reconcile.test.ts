import { describe, expect, it } from "vitest";
import { getReconciliationCandidates, reconcileCandidate, classifyThreadOutcome, type ReconcileDeps } from "./reconcile";
import type { WorkItemRow } from "@/lib/supabase/types";
import type { AIProvider, EmailThreadResult } from "@/lib/ai";
import type { ThreadSyncLogEntry } from "./applySync";

type Row = Record<string, unknown>;

/**
 * Fake minimo de supabase-js, mismo espiritu que src/lib/engine/undo.test.ts pero
 * generalizado (select/eq/in/order/limit/maybeSingle/single/update/insert) — suficiente para
 * los call-patterns reales de getReconciliationCandidates/reconcileCandidate/processThread.
 * No es un emulador de Postgrest: `select()` es un no-op (siempre devuelve la fila entera
 * guardada, no solo las columnas pedidas), y los joins embebidos (`work_item:work_item_id(*)`)
 * se simulan seedeando el campo `work_item` directamente en la fila de source_link.
 */
function makeFakeSupabase(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, [...v]]));

  function from(table: string) {
    let type: "select" | "insert" | "update" = "select";
    let payload: Row = {};
    let wantsSingle = false;
    let limitN: number | null = null;
    let orderCol: string | null = null;
    let orderAsc = true;
    const filters: Array<{ op: "eq" | "in"; col: string; val: unknown }> = [];

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
      eq(col: string, val: unknown) {
        filters.push({ op: "eq", col, val });
        return api;
      },
      in(col: string, vals: unknown[]) {
        filters.push({ op: "in", col, val: vals });
        return api;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAsc = opts?.ascending ?? true;
        return api;
      },
      limit(n: number) {
        limitN = n;
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
      return filters.every((f) => (f.op === "eq" ? row[f.col] === f.val : (f.val as unknown[]).includes(row[f.col])));
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
      let rows = (tables[table] ?? []).filter(matches);
      if (orderCol) {
        const col = orderCol;
        rows = [...rows].sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return orderAsc ? cmp : -cmp;
        });
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      return { data: wantsSingle ? (rows[0] ?? null) : rows, error: null };
    }

    return api;
  }

  return { from, tables };
}

/** Fake de gmail_v1.Gmail — soporta solo threads.get, en modo "minimal" (fingerprint barato,
 * ver getThreadVersion) o "full" (ver getThread). */
function makeFakeGmail(params: { minimalHistoryId: string | null; rawThread?: Record<string, unknown> }) {
  return {
    users: {
      threads: {
        get: async ({ format }: { format?: string }) => {
          if (format === "minimal") return { data: { historyId: params.minimalHistoryId } };
          if (format === "full") {
            if (!params.rawThread) throw new Error("full fetch (IA) no deberia haberse pedido en este test");
            return { data: params.rawThread };
          }
          throw new Error(`formato inesperado: ${format}`);
        },
      },
    },
  } as any;
}

const TODAY = "2026-08-12";

function baseWorkItem(overrides: Partial<WorkItemRow> = {}): WorkItemRow {
  return {
    id: "wi-1",
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
    case_id: null,
    ...overrides,
  };
}

function makeRawThread(
  threadId: string,
  historyId: string,
  messages: Array<{ id: string; from: string; dateISO: string; subject: string; body: string }>
) {
  return {
    id: threadId,
    historyId,
    messages: messages.map((m) => ({
      id: m.id,
      internalDate: String(new Date(m.dateISO).getTime()),
      snippet: m.body.slice(0, 50),
      payload: {
        headers: [
          { name: "From", value: m.from },
          { name: "To", value: "me@tmc.com" },
          { name: "Subject", value: m.subject },
        ],
        mimeType: "text/plain",
        body: { data: Buffer.from(m.body, "utf-8").toString("base64url") },
      },
    })),
  };
}

function fakeAIProvider(result: Partial<EmailThreadResult>): AIProvider {
  const full: EmailThreadResult = {
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
    ...result,
  };
  return {
    normalizeEmailThread: async () => full,
  } as unknown as AIProvider;
}

describe("getReconciliationCandidates", () => {
  it("incluye items ACTION (sin waiting_for_what) y WAITING por igual, mientras esten linkeados a Gmail y activos", async () => {
    const supabase = makeFakeSupabase({
      work_item: [
        { id: "wi-action", status: "OPEN", last_reconciled_at: null, last_reconciled_thread_version: null },
        { id: "wi-waiting", status: "OPEN", last_reconciled_at: null, last_reconciled_thread_version: null },
        { id: "wi-done", status: "DONE", last_reconciled_at: null, last_reconciled_thread_version: null },
      ],
      source_link: [
        { work_item_id: "wi-action", external_id: "t-action", source_type: "GMAIL", occurred_at: "2026-08-01T00:00:00.000Z" },
        { work_item_id: "wi-waiting", external_id: "t-waiting", source_type: "GMAIL", occurred_at: "2026-08-01T00:00:00.000Z" },
      ],
    });
    const candidates = await getReconciliationCandidates(supabase as any);
    expect(candidates.map((c) => c.workItemId).sort()).toEqual(["wi-action", "wi-waiting"]);
  });

  it("ordena los nunca-reconciliados/mas viejos primero", async () => {
    const supabase = makeFakeSupabase({
      work_item: [
        { id: "wi-recent", status: "OPEN", last_reconciled_at: "2026-08-11T00:00:00.000Z", last_reconciled_thread_version: "h1" },
        { id: "wi-never", status: "OPEN", last_reconciled_at: null, last_reconciled_thread_version: null },
      ],
      source_link: [
        { work_item_id: "wi-recent", external_id: "t-recent", source_type: "GMAIL", occurred_at: "2026-08-01T00:00:00.000Z" },
        { work_item_id: "wi-never", external_id: "t-never", source_type: "GMAIL", occurred_at: "2026-08-01T00:00:00.000Z" },
      ],
    });
    const candidates = await getReconciliationCandidates(supabase as any);
    expect(candidates.map((c) => c.workItemId)).toEqual(["wi-never", "wi-recent"]);
  });

  it("un item activo sin ningun source_link de Gmail no aparece como candidato", async () => {
    const supabase = makeFakeSupabase({
      work_item: [{ id: "wi-1", status: "OPEN", last_reconciled_at: null, last_reconciled_thread_version: null }],
      source_link: [],
    });
    const candidates = await getReconciliationCandidates(supabase as any);
    expect(candidates).toHaveLength(0);
  });
});

describe("reconcileCandidate — idempotencia (AI Work Manager no paga IA de mas)", () => {
  it("un candidato reconciliado hace menos de 1h se salta sin pedir ni el fingerprint (piso de seguridad)", async () => {
    const recentISO = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const supabase = makeFakeSupabase({
      work_item: [{ id: "wi-1", last_reconciled_at: recentISO, last_reconciled_thread_version: "h1" }],
    });
    let gmailCalled = false;
    const gmail = makeFakeGmail({ minimalHistoryId: "h2" });
    const realGet = gmail.users.threads.get;
    gmail.users.threads.get = async (...args: any[]) => {
      gmailCalled = true;
      return realGet(...args);
    };

    const deps: ReconcileDeps = {
      supabase: supabase as any,
      gmail,
      applyDeps: { aiProvider: fakeAIProvider({}), todayISO: TODAY, safeMode: false, userAddresses: ["me@tmc.com"] },
      userAddresses: ["me@tmc.com"],
    };
    const result = await reconcileCandidate(deps, {
      workItemId: "wi-1",
      threadId: "t-1",
      lastReconciledAt: recentISO,
      lastReconciledThreadVersion: "h1",
    });

    expect(result).toEqual({ checked: false, entry: null });
    expect(gmailCalled).toBe(false);
  });

  it("fuera del piso de 1h pero fingerprint sin cambios: no gasta IA (nunca pide el thread completo), solo actualiza last_reconciled_at/thread_version", async () => {
    const oldISO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const supabase = makeFakeSupabase({
      work_item: [{ id: "wi-1", last_reconciled_at: oldISO, last_reconciled_thread_version: "h1" }],
    });
    const gmail = makeFakeGmail({ minimalHistoryId: "h1" }); // mismo historyId que la ultima vez -> sin cambios

    const deps: ReconcileDeps = {
      supabase: supabase as any,
      gmail,
      applyDeps: { aiProvider: fakeAIProvider({}), todayISO: TODAY, safeMode: false, userAddresses: ["me@tmc.com"] },
      userAddresses: ["me@tmc.com"],
    };
    const result = await reconcileCandidate(deps, {
      workItemId: "wi-1",
      threadId: "t-1",
      lastReconciledAt: oldISO,
      lastReconciledThreadVersion: "h1",
    });

    expect(result).toEqual({ checked: true, entry: null });
    const updated = supabase.tables.work_item!.find((r) => r.id === "wi-1")!;
    expect(updated.last_reconciled_thread_version).toBe("h1");
    expect(new Date(updated.last_reconciled_at as string).getTime()).toBeGreaterThan(new Date(oldISO).getTime());
  });

  it("fingerprint cambiado en un item WAITING con reply nuevo -> corre el pipeline completo y termina en RECEIVED_CHECK", async () => {
    const oldISO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const existingWorkItem = baseWorkItem({
      id: "wi-1",
      title: "Cotizacion 13.2kV",
      waiting_for_what: "Confirmacion de tension",
      expected_date: "2026-08-15",
      last_activity_at: "2026-08-01T10:00:00.000Z",
    });

    const rawThread = makeRawThread("t-1", "h2", [
      { id: "m1", from: "me@tmc.com", dateISO: "2026-08-01T10:00:00.000Z", subject: "Cotizacion", body: "Te mando la cotizacion en 13.2kV" },
      {
        id: "m2",
        from: "cliente@ejemplo.com",
        dateISO: "2026-08-10T09:00:00.000Z",
        subject: "Cotizacion",
        body: "Finalmente sera 15kV, podrian recotizar?",
      },
    ]);

    const supabase = makeFakeSupabase({
      work_item: [{ id: "wi-1", last_reconciled_at: oldISO, last_reconciled_thread_version: "h1" }],
      source_link: [
        {
          work_item_id: "wi-1",
          external_id: "t-1",
          source_type: "GMAIL",
          occurred_at: "2026-08-01T10:00:00.000Z",
          work_item: existingWorkItem,
        },
      ],
      review_item: [],
    });

    const gmail = makeFakeGmail({ minimalHistoryId: "h2", rawThread });
    // classification=IGNORE a proposito: RECEIVED_CHECK tiene prioridad absoluta sobre lo que
    // diga la IA (ver decisionEngine.ts), asi que esto prueba que el gate no depende de eso.
    const aiProvider = fakeAIProvider({
      relevance: "WORK",
      classification: "IGNORE",
      confidence: "HIGH",
      rationale: "El cliente cambio el requerimiento a 15kV",
      evidence: "Finalmente sera 15kV, podrian recotizar?",
    });

    const deps: ReconcileDeps = {
      supabase: supabase as any,
      gmail,
      applyDeps: { aiProvider, todayISO: TODAY, safeMode: false, userAddresses: ["me@tmc.com"] },
      userAddresses: ["me@tmc.com"],
    };

    const result = await reconcileCandidate(deps, {
      workItemId: "wi-1",
      threadId: "t-1",
      lastReconciledAt: oldISO,
      lastReconciledThreadVersion: "h1",
    });

    expect(result.checked).toBe(true);
    expect(result.entry?.action).toBe("RECEIVED_CHECK");
    expect(result.entry?.resultingWorkItemId).toBe("wi-1");

    const reviewItems = supabase.tables.review_item ?? [];
    expect(reviewItems).toHaveLength(1);
    expect(reviewItems[0]?.kind).toBe("RECEIVED_CHECK");
    expect(reviewItems[0]?.work_item_id).toBe("wi-1");

    const updatedWorkItem = supabase.tables.work_item!.find((r) => r.id === "wi-1")!;
    expect(updatedWorkItem.last_reconciled_thread_version).toBe("h2");
  });
});

function logEntry(overrides: Partial<ThreadSyncLogEntry> = {}): ThreadSyncLogEntry {
  return {
    threadId: "t-1",
    subject: "Asunto",
    ruleFilterSkipped: false,
    ruleFilterReason: null,
    llmCalled: true,
    relevance: "WORK",
    classification: "ACTION",
    confidence: "HIGH",
    isDelegation: false,
    attentionOwner: "FELIPE",
    teamOtherRelation: null,
    action: "AUTO_CREATE",
    ...overrides,
  };
}

describe("classifyThreadOutcome — un balde mutuamente excluyente por thread, para las metricas DE ESTA CORRIDA", () => {
  it("rule-filtered (nunca llego a la IA) -> RULE_FILTERED, sin importar action", () => {
    expect(classifyThreadOutcome(logEntry({ ruleFilterSkipped: true, llmCalled: false, action: "IGNORE (rule filter)" }))).toBe(
      "RULE_FILTERED"
    );
  });

  it("action=ERROR -> FAILED, incluso si por algun motivo ruleFilterSkipped quedo en false", () => {
    expect(classifyThreadOutcome(logEntry({ action: "ERROR" }))).toBe("FAILED");
  });

  it("AUTO_CREATE -> AUTO_CREATED", () => {
    expect(classifyThreadOutcome(logEntry({ action: "AUTO_CREATE" }))).toBe("AUTO_CREATED");
  });

  it("AUTO_UPDATE -> AUTO_UPDATED", () => {
    expect(classifyThreadOutcome(logEntry({ action: "AUTO_UPDATE" }))).toBe("AUTO_UPDATED");
  });

  it("NO_OP -> NO_OP", () => {
    expect(classifyThreadOutcome(logEntry({ action: "NO_OP" }))).toBe("NO_OP");
  });

  it("RECEIVED_CHECK -> REVIEW_CREATED (siempre crea un review_item, nunca se auto-aplica)", () => {
    expect(classifyThreadOutcome(logEntry({ action: "RECEIVED_CHECK" }))).toBe("REVIEW_CREATED");
  });

  it.each(["REVIEW_UPDATE_WORK_ITEM", "REVIEW_NEW_WORK_ITEM", "REVIEW_POSSIBLE_DUPLICATE", "REVIEW_POTENTIAL_COMMITMENT"])(
    "%s -> REVIEW_CREATED",
    (action) => {
      expect(classifyThreadOutcome(logEntry({ action }))).toBe("REVIEW_CREATED");
    }
  );

  it.each(["WOULD_CREATE (automation off)", "WOULD_UPDATE (automation off)"])(
    "%s (safe_mode) -> REVIEW_CREATED (es lo que realmente paso en la DB esta corrida)",
    (action) => {
      expect(classifyThreadOutcome(logEntry({ action }))).toBe("REVIEW_CREATED");
    }
  );

  it("IGNORE (classification=IGNORE / relevance=PERSONAL / INFO sin accionable) -> IGNORED", () => {
    expect(classifyThreadOutcome(logEntry({ action: "IGNORE" }))).toBe("IGNORED");
  });
});
