import { describe, expect, it } from "vitest";
import { applyCaseStateGate, processThreadForCase, type CaseAnalysisDeps } from "./caseAnalysis";
import type { CaseStateResult } from "@/lib/ai/caseSchema";
import type { AIProvider } from "@/lib/ai";
import type { NormalizedMessage, NormalizedThread } from "@/lib/gmail/types";

function stateResult(overrides: Partial<CaseStateResult> = {}): CaseStateResult {
  return {
    case_title: "Cotización X",
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
    summary: "resumen de prueba",
    ...overrides,
  };
}

describe("applyCaseStateGate", () => {
  const HIGH_CONFIDENCE_WAITING = stateResult();

  it("safeMode=true siempre REVIEW, sin importar el resultado", () => {
    expect(applyCaseStateGate(HIGH_CONFIDENCE_WAITING, true)).toBe("REVIEW");
  });

  it("current_owner=UNKNOWN siempre REVIEW", () => {
    expect(applyCaseStateGate(stateResult({ current_owner: "UNKNOWN" }), false)).toBe("REVIEW");
  });

  it("current_state=REVIEW (señal propia del modelo) siempre REVIEW", () => {
    expect(applyCaseStateGate(stateResult({ current_state: "REVIEW" }), false)).toBe("REVIEW");
  });

  it("confidence=LOW siempre REVIEW", () => {
    expect(applyCaseStateGate(stateResult({ confidence: "LOW" }), false)).toBe("REVIEW");
  });

  it("CLOSED con confidence HIGH y evidencia inequivoca -> PASS", () => {
    expect(applyCaseStateGate(stateResult({ current_state: "CLOSED", confidence: "HIGH", closure_evidence_unambiguous: true }), false)).toBe(
      "PASS"
    );
  });

  it("CLOSED con confidence HIGH pero SIN evidencia inequivoca -> REVIEW (nunca 'cerrar por las dudas')", () => {
    expect(
      applyCaseStateGate(stateResult({ current_state: "CLOSED", confidence: "HIGH", closure_evidence_unambiguous: false }), false)
    ).toBe("REVIEW");
  });

  it("CLOSED con confidence MEDIUM, aunque closure_evidence_unambiguous sea true -> REVIEW", () => {
    expect(
      applyCaseStateGate(stateResult({ current_state: "CLOSED", confidence: "MEDIUM", closure_evidence_unambiguous: true }), false)
    ).toBe("REVIEW");
  });

  it("caso normal (owner conocido, confidence HIGH/MEDIUM, no CLOSED, no REVIEW) -> PASS", () => {
    expect(applyCaseStateGate(HIGH_CONFIDENCE_WAITING, false)).toBe("PASS");
    expect(applyCaseStateGate(stateResult({ confidence: "MEDIUM" }), false)).toBe("PASS");
  });

  it("NO_ACTION con confidence LOW -> PASS (INFO/FYI ya resuelto, evitar ruido en Review)", () => {
    expect(
      applyCaseStateGate(stateResult({ current_state: "NO_ACTION", current_owner: "NONE", confidence: "LOW" }), false)
    ).toBe("PASS");
  });

  it("NO_ACTION con owner UNKNOWN sigue yendo a REVIEW aunque el estado no sea ambiguo (owner dudoso manda)", () => {
    expect(
      applyCaseStateGate(stateResult({ current_state: "NO_ACTION", current_owner: "UNKNOWN", confidence: "LOW" }), false)
    ).toBe("REVIEW");
  });
});

// ---------- fake supabase (mismo patron generalizado que catchup.test.ts, + neq) ----------

type Row = Record<string, unknown>;

function makeFakeSupabase(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, [...v]]));

  function from(table: string) {
    let type: "select" | "insert" | "update" = "select";
    let payload: Row = {};
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
      const rows = (tables[table] ?? []).filter(matches);
      return { data: wantsSingle ? (rows[0] ?? null) : rows, error: null };
    }

    return api;
  }

  return { from, tables };
}

function msg(overrides: Partial<NormalizedMessage> & Pick<NormalizedMessage, "id" | "direction" | "bodyText">): NormalizedMessage {
  return {
    from: overrides.direction === "OUTBOUND" ? "felipe@tmc.com" : "cliente@empresa.com",
    fromName: overrides.direction === "OUTBOUND" ? "Felipe" : "Cliente",
    to: [],
    cc: [],
    subject: "Cotización S00103",
    date: "2026-08-10T10:00:00.000Z",
    snippet: overrides.bodyText.slice(0, 80),
    hasListUnsubscribe: false,
    ...overrides,
  };
}

function thread(overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    threadId: "t-1",
    historyId: "h1",
    subject: "Cotización S00103",
    webUrl: "https://mail.google.com/mail/u/0/#inbox/t-1",
    messages: [msg({ id: "m1", direction: "INBOUND", bodyText: "¿Me cotizan este transformador? Ref S00103." })],
    ...overrides,
  };
}

function fakeProvider(result: Partial<CaseStateResult> | ((entries: unknown) => Partial<CaseStateResult>)): AIProvider {
  return {
    normalizeManualCapture: async () => {
      throw new Error("unused");
    },
    normalizeEmailThread: async () => {
      throw new Error("unused");
    },
    normalizeWhatsAppConversation: async () => {
      throw new Error("unused");
    },
    analyzeCaseState: async (input, onUsage) => {
      onUsage?.({ inputTokens: 100, outputTokens: 20 });
      const partial = typeof result === "function" ? result(input.entries) : result;
      return stateResult(partial);
    },
    getModel: () => "test-model",
  };
}

function baseDeps(supabase: ReturnType<typeof makeFakeSupabase>, provider: AIProvider): CaseAnalysisDeps {
  return {
    supabase: supabase as any,
    aiProvider: provider,
    todayISO: "2026-08-13",
    safeMode: false,
    userAddresses: ["felipe@tmc.com"],
    internalTeamMembers: [{ name: "Felipe", email: "felipe@tmc.com" }, { name: "Thomas", email: "thomas@tmc.com" }],
  };
}

describe("processThreadForCase", () => {
  it("thread filtrado por regla -> IGNORE, nunca llama a la IA ni toca la DB de Cases", async () => {
    const supabase = makeFakeSupabase({ case: [], case_source_link: [] });
    const t = thread({
      subject: "Newsletter semanal",
      messages: [
        {
          id: "m1",
          direction: "INBOUND",
          from: "news@list.com",
          fromName: null,
          to: [],
          cc: [],
          subject: "Newsletter",
          date: "2026-08-10T10:00:00.000Z",
          snippet: "",
          bodyText: "novedades",
          hasListUnsubscribe: true,
        },
      ],
    });
    const log = await processThreadForCase(baseDeps(supabase, fakeProvider({})), t);
    expect(log.ruleFilterSkipped).toBe(true);
    expect(log.action).toBe("IGNORE (rule filter)");
    expect(log.llmCalled).toBe(false);
    expect(supabase.tables.case).toHaveLength(0);
  });

  it("sin match (NONE) -> crea un Case nuevo, reanaliza, y auto-aplica el estado (confidence HIGH)", async () => {
    const supabase = makeFakeSupabase({ case: [], case_source_link: [], contact: [], company: [] });
    const log = await processThreadForCase(baseDeps(supabase, fakeProvider({ current_state: "WAITING_EXTERNAL", current_owner: "EXTERNAL" })), thread());

    expect(log.action).toBe("AUTO_CREATE_CASE");
    expect(log.currentState).toBe("WAITING_EXTERNAL");
    expect(supabase.tables.case).toHaveLength(1);
    expect(supabase.tables.case![0]!.current_state).toBe("WAITING_EXTERNAL");
    expect(supabase.tables.case![0]!.reference_value).toBe("S00103");
    expect(supabase.tables.case_source_link).toHaveLength(1);
  });

  it("match EXACT (misma referencia contra un Case abierto) -> AUTO_MERGE, agrega source, reanaliza con historia completa", async () => {
    const existingCase = {
      id: "case-1",
      title: "Cotización S00103",
      company_id: null,
      contact_id: null,
      context_id: null,
      reference_type: "QUOTE",
      reference_value: "S00103",
      current_state: "DELEGATED_INTERNAL",
      current_owner: "TEAM",
      felipe_action_required: false,
      next_action: null,
      waiting_for: "Que Thomas envie la oferta",
      responsible: "Thomas",
      due_date: null,
      expected_date: null,
      risk: "NORMAL",
      confidence: "HIGH",
      ai_summary: null,
      last_meaningful_event: "Delegado a Thomas",
      last_activity_at: "2026-08-01T00:00:00.000Z",
      ai_calls_count: 1,
      ai_input_tokens: 50,
      ai_output_tokens: 10,
      is_demo: false,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    };
    const supabase = makeFakeSupabase({ case: [existingCase], case_source_link: [], contact: [], company: [] });

    const t = thread({
      threadId: "t-2",
      messages: [msg({ id: "m-follow", direction: "OUTBOUND", bodyText: "Thomas confirma: Enviada. Ref S00103." })],
    });
    const log = await processThreadForCase(
      baseDeps(supabase, fakeProvider({ current_state: "WAITING_EXTERNAL", current_owner: "EXTERNAL" })),
      t
    );

    expect(log.matchTier).toBe("EXACT");
    expect(log.action).toBe("AUTO_MERGE");
    expect(log.resultingCaseId).toBe("case-1");
    expect(supabase.tables.case).toHaveLength(1);
    expect(supabase.tables.case![0]!.current_state).toBe("WAITING_EXTERNAL");
    expect(supabase.tables.case_source_link).toHaveLength(1);
    expect(supabase.tables.case_source_link![0]!.case_id).toBe("case-1");
  });

  it("match PROBABLE/AMBIGUOUS -> CASE_MERGE_REVIEW, nunca auto-mergea ni gasta una llamada de IA", async () => {
    const existingCase = {
      id: "case-1",
      title: "Cotización transformador Cirion 3150 kVA",
      company_id: "company-1",
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
      last_activity_at: "2026-08-12T00:00:00.000Z",
      ai_calls_count: 0,
      ai_input_tokens: 0,
      ai_output_tokens: 0,
      is_demo: false,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    };
    const contact = { id: "contact-1", name: "Cliente", email: "cliente@empresa.com", phone_e164: null, company_id: "company-1", tier: "B", is_demo: false, created_at: "2026-08-01T00:00:00.000Z" };
    const supabase = makeFakeSupabase({ case: [existingCase], case_source_link: [], contact: [contact], company: [], review_item: [] });

    let aiCalled = false;
    const provider = fakeProvider({});
    provider.analyzeCaseState = async () => {
      aiCalled = true;
      throw new Error("no deberia llamarse — match ambiguo no gasta IA");
    };

    const t = thread({
      threadId: "t-3",
      subject: "Consulta sobre transformador Cirion",
      messages: [msg({ id: "m1", direction: "INBOUND", bodyText: "¿Cómo va la consulta del transformador Cirion?" })],
    });
    const log = await processThreadForCase(baseDeps(supabase, provider), t);

    expect(log.matchTier).toBe("PROBABLE");
    expect(log.action).toBe("CASE_MERGE_REVIEW");
    expect(aiCalled).toBe(false);
    expect(supabase.tables.case).toHaveLength(1); // no se creo ni se toco el existente
    expect(supabase.tables.review_item).toHaveLength(1);
    expect(supabase.tables.review_item![0]!.kind).toBe("CASE_MERGE_REVIEW");
    expect(supabase.tables.review_item![0]!.case_id).toBeNull();
  });

  it("gate REVIEW (confidence LOW) -> crea CASE_STATE_REVIEW y el Case queda en REVIEW, no en el estado propuesto", async () => {
    const supabase = makeFakeSupabase({ case: [], case_source_link: [], contact: [], company: [], review_item: [] });
    const log = await processThreadForCase(baseDeps(supabase, fakeProvider({ confidence: "LOW" })), thread());

    expect(log.action).toBe("CASE_STATE_REVIEW");
    expect(supabase.tables.case).toHaveLength(1);
    expect(supabase.tables.case![0]!.current_state).toBe("REVIEW");
    expect(supabase.tables.review_item).toHaveLength(1);
    expect(supabase.tables.review_item![0]!.kind).toBe("CASE_STATE_REVIEW");
    expect(supabase.tables.review_item![0]!.case_id).toBe(supabase.tables.case![0]!.id);
  });

  it("reprocesar el mismo thread (mismo mensaje) sobre el mismo Case es idempotente — no duplica case_source_link", async () => {
    const supabase = makeFakeSupabase({ case: [], case_source_link: [], contact: [], company: [] });
    const t = thread();
    await processThreadForCase(baseDeps(supabase, fakeProvider({})), t);
    await processThreadForCase(baseDeps(supabase, fakeProvider({})), t);

    expect(supabase.tables.case).toHaveLength(1); // no crea un segundo Case
    expect(supabase.tables.case_source_link).toHaveLength(1); // no duplica el mensaje ya vinculado
  });

  it("safeMode=true fuerza CASE_STATE_REVIEW aunque el resultado sea HIGH confidence", async () => {
    const supabase = makeFakeSupabase({ case: [], case_source_link: [], contact: [], company: [], review_item: [] });
    const deps = { ...baseDeps(supabase, fakeProvider({})), safeMode: true };
    const log = await processThreadForCase(deps, thread());

    expect(log.action).toBe("CASE_STATE_REVIEW");
    expect(supabase.tables.case![0]!.current_state).toBe("REVIEW");
  });
});
