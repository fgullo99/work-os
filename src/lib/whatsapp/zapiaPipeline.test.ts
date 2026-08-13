import { describe, expect, it } from "vitest";
import { computeZapiaIdempotencyKey, processZapiaConversation } from "./zapiaPipeline";
import type { ZapiaConversationUnit } from "./zapiaSchema";
import type { AIProvider, NormalizeWhatsAppConversationInput } from "@/lib/ai/types";
import type { WhatsAppConversationResult } from "@/lib/ai/whatsappSchema";

function unit(overrides: Partial<ZapiaConversationUnit> = {}): ZapiaConversationUnit {
  return {
    batchId: "batch-1",
    capturedAt: "2026-08-10T15:00:00Z",
    timezone: "America/Argentina/Buenos_Aires",
    conversation: { chat_id: "chat-1", chat_name: "Cliente A", contact_name: "Juan", phone: null },
    messages: [{ message_id: "m1", direction: "inbound", sent_at: "2026-08-10T14:55:00Z", text: "Mandame el precio." }],
    ...overrides,
  };
}

function fakeAIProvider(result: Partial<WhatsAppConversationResult> | ((input: NormalizeWhatsAppConversationInput) => Partial<WhatsAppConversationResult>)): AIProvider {
  const base: WhatsAppConversationResult = {
    relevance: "WORK",
    classification: "ACTION",
    next_action: "Mandar el precio",
    waiting_for_person: null,
    waiting_for_what: null,
    due_date_phrase: null,
    expected_date_phrase: null,
    committed_date_phrase: null,
    responsible: null,
    suggested_company: null,
    suggested_contact: "Juan",
    suggested_context: null,
    suggested_category: null,
    blocking: false,
    confidence: "HIGH",
    evidence: "Mandame el precio.",
    summary: "Juan pide el precio.",
  };
  return {
    normalizeManualCapture: async () => {
      throw new Error("not used in these tests");
    },
    normalizeEmailThread: async () => {
      throw new Error("not used in these tests");
    },
    normalizeWhatsAppConversation: async (input) => ({
      ...base,
      ...(typeof result === "function" ? result(input) : result),
    }),
    analyzeCaseState: async () => {
      throw new Error("not used in these tests");
    },
    getModel: () => "test-model",
  };
}

type Row = Record<string, unknown>;

/** Fake minimo de supabase-js suficiente para los call-patterns exactos que usa
 * zapiaPipeline.ts (ver el enumerado de llamadas en la implementacion). No es un emulador
 * general de Postgrest — cada tabla tiene datos seed configurables y las escrituras
 * (insert/update) se registran en `writes` para poder afirmar sobre ellas. */
interface FakeTables {
  whatsapp_ingestion: Row[];
  company: Row[];
  contact: Row[];
  context: Row[];
  source_link: Row[];
  work_item: Row[];
  review_item: Row[];
  automation_settings: Row[];
  ai_action_log: Row[];
  [key: string]: Row[];
}

function makeFakeSupabase(
  seed: {
    whatsapp_ingestion?: Row[];
    company?: Row[];
    contact?: Row[];
    context?: Row[];
    source_link?: Row[];
    work_item?: Row[];
    automation_settings?: Row[];
  } = {}
) {
  const tables: FakeTables = {
    whatsapp_ingestion: seed.whatsapp_ingestion ?? [],
    company: seed.company ?? [],
    contact: seed.contact ?? [],
    context: seed.context ?? [],
    source_link: seed.source_link ?? [],
    work_item: seed.work_item ?? [],
    review_item: [],
    automation_settings: seed.automation_settings ?? [],
    ai_action_log: [],
  };
  const writes: { table: string; type: "insert" | "update"; payload: Row; filters: Array<[string, unknown]> }[] = [];
  let nextId = 1;

  function from(table: string) {
    let type: "select" | "insert" | "update" = "select";
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
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return api;
      },
      in(col: string, vals: unknown[]) {
        filters.push([col, vals]);
        return api;
      },
      or() {
        return api;
      },
      order() {
        return api;
      },
      limit() {
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
      return filters.every(([col, val]) => {
        if (Array.isArray(val)) return val.includes(row[col]);
        return row[col] === val;
      });
    }

    function resolve(wantsSingle: boolean): Promise<{ data: unknown; error: null; count: number | null }> {
      if (type === "insert") {
        const row: Row = { id: `${table}-${nextId++}`, ...payload };
        tables[table] = [...(tables[table] ?? []), row];
        writes.push({ table, type: "insert", payload: row, filters: [] });
        return Promise.resolve({ data: wantsSingle ? row : [row], error: null, count: 1 });
      }
      if (type === "update") {
        tables[table] = (tables[table] ?? []).map((row) => (matchesFilters(row) ? { ...row, ...payload } : row));
        writes.push({ table, type: "update", payload, filters: [...filters] });
        return Promise.resolve({ data: null, error: null, count: null });
      }
      const rows = (tables[table] ?? []).filter(matchesFilters);
      if (table === "source_link" && rows.length > 0 && "work_item_id" in rows[0]!) {
        const withRelation = rows.map((row) => ({
          ...row,
          work_item: (tables.work_item ?? []).find((wi) => wi.id === row.work_item_id) ?? null,
        }));
        return Promise.resolve({ data: wantsSingle ? withRelation[0] ?? null : withRelation, error: null, count: withRelation.length });
      }
      return Promise.resolve({ data: wantsSingle ? rows[0] ?? null : rows, error: null, count: rows.length });
    }

    return api;
  }

  return { from, writes, tables };
}

describe("computeZapiaIdempotencyKey", () => {
  it("is identical for the same set of message_ids regardless of order", () => {
    const a = computeZapiaIdempotencyKey(unit({ messages: [{ message_id: "m1", direction: "inbound", sent_at: null, text: "x" }, { message_id: "m2", direction: "outbound", sent_at: null, text: "y" }] }));
    const b = computeZapiaIdempotencyKey(unit({ messages: [{ message_id: "m2", direction: "outbound", sent_at: null, text: "y" }, { message_id: "m1", direction: "inbound", sent_at: null, text: "x" }] }));
    expect(a).toBe(b);
  });

  it("differs when message content differs and there are no message_ids", () => {
    const a = computeZapiaIdempotencyKey(unit({ messages: [{ message_id: null, direction: "inbound", sent_at: "t1", text: "hola" }] }));
    const b = computeZapiaIdempotencyKey(unit({ messages: [{ message_id: null, direction: "inbound", sent_at: "t1", text: "chau" }] }));
    expect(a).not.toBe(b);
  });

  it("is identical for an exact retry (same payload) without message_ids", () => {
    const payload = unit({ messages: [{ message_id: null, direction: "inbound", sent_at: "t1", text: "hola" }] });
    expect(computeZapiaIdempotencyKey(payload)).toBe(computeZapiaIdempotencyKey(payload));
  });
});

describe("processZapiaConversation", () => {
  it("classifies an inbound message asking the user for something as ACTION and creates a Review item", async () => {
    const supabase = makeFakeSupabase();
    const ai = fakeAIProvider({ classification: "ACTION", next_action: "Mandar el precio", waiting_for_what: null });
    const entry = await processZapiaConversation({ supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" }, unit());

    expect(entry.outcome).toBe("review_created");
    expect(entry.classification).toBe("ACTION");
    const reviewRows = supabase.tables.review_item;
    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0]?.kind).toBe("NEW_WORK_ITEM");
    expect((reviewRows[0]?.proposed_payload as any).next_action).toBe("Mandar el precio");
  });

  it("classifies an outbound question as WAITING", async () => {
    const supabase = makeFakeSupabase();
    const ai = fakeAIProvider({
      classification: "WAITING",
      next_action: null,
      waiting_for_what: "Confirmacion de tension",
      waiting_for_person: null,
    });
    const entry = await processZapiaConversation(
      { supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" },
      unit({ messages: [{ message_id: "m1", direction: "outbound", sent_at: null, text: "¿Me confirmás la tensión?" }] })
    );
    expect(entry.outcome).toBe("review_created");
    expect(entry.classification).toBe("WAITING");
  });

  it("supports an external commitment (inbound promise) and an own commitment (outbound promise)", async () => {
    const supabaseExternal = makeFakeSupabase();
    const externalAi = fakeAIProvider({ classification: "WAITING", waiting_for_what: "Planos", expected_date_phrase: "viernes" });
    const externalEntry = await processZapiaConversation(
      { supabase: supabaseExternal as any, aiProvider: externalAi, todayISO: "2026-08-10" },
      unit({ messages: [{ message_id: "m1", direction: "inbound", sent_at: null, text: "Te mando los planos el viernes." }] })
    );
    expect(externalEntry.classification).toBe("WAITING");

    const supabaseOwn = makeFakeSupabase();
    const ownAi = fakeAIProvider({ classification: "ACTION", next_action: "Mandar la oferta", committed_date_phrase: "mañana" });
    const ownEntry = await processZapiaConversation(
      { supabase: supabaseOwn as any, aiProvider: ownAi, todayISO: "2026-08-10" },
      unit({ messages: [{ message_id: "m1", direction: "outbound", sent_at: null, text: "Te paso la oferta mañana." }] })
    );
    expect(ownEntry.classification).toBe("ACTION");
    expect((supabaseOwn.tables.review_item[0]?.proposed_payload as any).committed_date).not.toBeNull();
  });

  it("allows ACTION and WAITING to coexist in the same proposed payload", async () => {
    const supabase = makeFakeSupabase();
    const ai = fakeAIProvider({ classification: "ACTION", next_action: "Enviar cotizacion", waiting_for_what: "Confirmacion de stock" });
    const entry = await processZapiaConversation({ supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" }, unit());
    expect(entry.outcome).toBe("review_created");
    const payload = supabase.tables.review_item[0]?.proposed_payload as any;
    expect(payload.next_action).toBe("Enviar cotizacion");
    expect(payload.waiting_for_what).toBe("Confirmacion de stock");
  });

  it("never creates or updates a work_item row directly — HIGH confidence still goes to Review", async () => {
    const supabase = makeFakeSupabase();
    const ai = fakeAIProvider({ classification: "ACTION", confidence: "HIGH" });
    await processZapiaConversation({ supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" }, unit());
    expect(supabase.writes.some((w) => w.table === "work_item")).toBe(false);
    expect(supabase.tables.review_item).toHaveLength(1);
  });

  it("proposes UPDATE_WORK_ITEM when the same chat_id already has a linked Work Item", async () => {
    const supabase = makeFakeSupabase({
      work_item: [{ id: "wi-1", title: "Cliente A - Trafo", status: "OPEN", next_action: null, waiting_for_what: null, expected_date: null, due_date: null, committed_date: null }],
      source_link: [{ id: "sl-1", work_item_id: "wi-1", source_type: "WHATSAPP", external_id: "chat-1", occurred_at: "2026-08-01" }],
    });
    const ai = fakeAIProvider({ classification: "ACTION" });
    const entry = await processZapiaConversation({ supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" }, unit());
    expect(entry.outcome).toBe("review_created");
    expect(supabase.tables.review_item[0]?.kind).toBe("UPDATE_WORK_ITEM");
    expect(supabase.tables.review_item[0]?.work_item_id).toBe("wi-1");
  });

  it("proposes POSSIBLE_DUPLICATE when a similarly-titled open Work Item exists for the same contact (e.g. a Gmail-sourced one)", async () => {
    const supabase = makeFakeSupabase({
      contact: [{ id: "contact-1", name: "Juan" }],
      work_item: [
        {
          id: "wi-gmail-1",
          title: "Juan - Trafo 1600 kVA precio",
          status: "OPEN",
          contact_id: "contact-1",
          company_id: null,
          context_id: null,
        },
      ],
    });
    const ai = fakeAIProvider({ classification: "ACTION", suggested_contact: "Juan", suggested_context: "Trafo 1600 kVA precio" });
    const entry = await processZapiaConversation({ supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" }, unit());
    expect(entry.outcome).toBe("review_created");
    expect(supabase.tables.review_item[0]?.kind).toBe("POSSIBLE_DUPLICATE");
    expect(supabase.tables.review_item[0]?.duplicate_candidate_ids).toEqual(["wi-gmail-1"]);
  });

  it("marks IGNORE conversations as ignored without creating a Review item", async () => {
    const supabase = makeFakeSupabase();
    const ai = fakeAIProvider({ classification: "IGNORE", next_action: null, waiting_for_what: null, evidence: null });
    const entry = await processZapiaConversation({ supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" }, unit());
    expect(entry.outcome).toBe("ignored");
    expect(supabase.tables.review_item).toHaveLength(0);
  });

  it("is idempotent: processing the exact same conversation twice only creates one Review item", async () => {
    const supabase = makeFakeSupabase();
    const ai = fakeAIProvider({ classification: "ACTION" });
    const deps = { supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" };
    const first = await processZapiaConversation(deps, unit());
    const second = await processZapiaConversation(deps, unit());

    expect(first.outcome).toBe("review_created");
    expect(second.outcome).toBe("duplicate");
    expect(supabase.tables.review_item).toHaveLength(1);
  });

  it("processes a batch of conversations independently — one failure does not lose the rest", async () => {
    const supabase = makeFakeSupabase();
    const ai: AIProvider = {
      normalizeManualCapture: async () => {
        throw new Error("unused");
      },
      normalizeEmailThread: async () => {
        throw new Error("unused");
      },
      normalizeWhatsAppConversation: async (input) => {
        if (input.unit.conversation.chat_id === "chat-fail") {
          throw new Error("Anthropic no disponible");
        }
        return {
          relevance: "WORK",
          classification: "ACTION",
          next_action: "hacer algo",
          waiting_for_person: null,
          waiting_for_what: null,
          due_date_phrase: null,
          expected_date_phrase: null,
          committed_date_phrase: null,
          responsible: null,
          suggested_company: null,
          suggested_contact: null,
          suggested_context: null,
          suggested_category: null,
          blocking: false,
          confidence: "HIGH",
          evidence: "hacer algo",
          summary: "resumen",
        };
      },
      analyzeCaseState: async () => {
        throw new Error("unused");
      },
      getModel: () => "test-model",
    };

    const units = [
      unit({
        conversation: { chat_id: "chat-ok-1", chat_name: null, contact_name: "A", phone: null },
        messages: [{ message_id: "batch-m1", direction: "inbound", sent_at: null, text: "conversacion 1" }],
      }),
      unit({
        conversation: { chat_id: "chat-fail", chat_name: null, contact_name: "B", phone: null },
        messages: [{ message_id: "batch-m2", direction: "inbound", sent_at: null, text: "conversacion 2" }],
      }),
      unit({
        conversation: { chat_id: "chat-ok-2", chat_name: null, contact_name: "C", phone: null },
        messages: [{ message_id: "batch-m3", direction: "inbound", sent_at: null, text: "conversacion 3" }],
      }),
    ];

    const outcomes = [];
    for (const u of units) {
      outcomes.push(await processZapiaConversation({ supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" }, u));
    }

    expect(outcomes.map((o) => o.outcome)).toEqual(["review_created", "failed", "review_created"]);
    expect(supabase.tables.review_item).toHaveLength(2);
  });

  it("on Anthropic failure, leaves the ingestion row in ERROR (retryable) without losing the messages", async () => {
    const supabase = makeFakeSupabase();
    const ai: AIProvider = {
      normalizeManualCapture: async () => {
        throw new Error("unused");
      },
      normalizeEmailThread: async () => {
        throw new Error("unused");
      },
      normalizeWhatsAppConversation: async () => {
        throw new Error("Anthropic no disponible");
      },
      analyzeCaseState: async () => {
        throw new Error("unused");
      },
      getModel: () => "test-model",
    };

    const entry = await processZapiaConversation({ supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" }, unit());
    expect(entry.outcome).toBe("failed");
    expect(supabase.tables.whatsapp_ingestion).toHaveLength(1);
    expect(supabase.tables.whatsapp_ingestion[0]?.status).toBe("ERROR");
    expect(supabase.tables.whatsapp_ingestion[0]?.chat_id).toBe("chat-1");
  });

  it("retries a conversation whose ingestion previously ended in ERROR", async () => {
    const supabase = makeFakeSupabase();
    const failingAi: AIProvider = {
      normalizeManualCapture: async () => {
        throw new Error("unused");
      },
      normalizeEmailThread: async () => {
        throw new Error("unused");
      },
      normalizeWhatsAppConversation: async () => {
        throw new Error("Anthropic no disponible");
      },
      analyzeCaseState: async () => {
        throw new Error("unused");
      },
      getModel: () => "test-model",
    };
    const first = await processZapiaConversation({ supabase: supabase as any, aiProvider: failingAi, todayISO: "2026-08-10" }, unit());
    expect(first.outcome).toBe("failed");

    const workingAi = fakeAIProvider({ classification: "ACTION" });
    const second = await processZapiaConversation({ supabase: supabase as any, aiProvider: workingAi, todayISO: "2026-08-10" }, unit());
    expect(second.outcome).toBe("review_created");
    expect(supabase.tables.whatsapp_ingestion).toHaveLength(1);
    expect(supabase.tables.whatsapp_ingestion[0]?.status).toBe("PROCESSED");
  });

  it("relevance=PERSONAL is ignored even when classification looks like ACTION and confidence is HIGH", async () => {
    const supabase = makeFakeSupabase();
    const ai = fakeAIProvider({ relevance: "PERSONAL", classification: "ACTION", next_action: "Comprar pan", confidence: "HIGH" });
    const entry = await processZapiaConversation({ supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" }, unit());
    expect(entry.outcome).toBe("ignored");
    expect(entry.relevance).toBe("PERSONAL");
    expect(supabase.tables.review_item).toHaveLength(0);
  });

  it("with whatsapp_auto_enabled=false (default), a WORK+HIGH conversation still goes to Review, never auto-creates", async () => {
    const supabase = makeFakeSupabase();
    const ai = fakeAIProvider({
      relevance: "WORK",
      classification: "ACTION",
      next_action: "Mandar el precio",
      suggested_contact: "Juan",
      confidence: "HIGH",
    });
    const entry = await processZapiaConversation({ supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" }, unit());
    expect(entry.outcome).toBe("review_created");
    expect(supabase.writes.some((w) => w.table === "work_item")).toBe(false);
  });

  it("with whatsapp_auto_enabled=true, WORK+HIGH+clear actor/action auto-creates a Work Item and logs ai_action_log", async () => {
    const supabase = makeFakeSupabase({ automation_settings: [{ whatsapp_auto_enabled: true }] });
    const ai = fakeAIProvider({
      relevance: "WORK",
      classification: "ACTION",
      next_action: "Mandar el precio",
      suggested_contact: "Juan",
      confidence: "HIGH",
    });
    const entry = await processZapiaConversation({ supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" }, unit());
    expect(entry.outcome).toBe("auto_created");
    expect(supabase.tables.work_item).toHaveLength(1);
    expect(supabase.tables.work_item[0]?.next_action).toBe("Mandar el precio");
    expect(supabase.tables.review_item[0]?.status).toBe("ACCEPTED");
    const logRows = supabase.tables.ai_action_log;
    expect(logRows).toHaveLength(1);
    expect(logRows[0]?.source_type).toBe("WHATSAPP");
    expect(logRows[0]?.action).toBe("CREATE");
  });

  it("with whatsapp_auto_enabled=true but relevance=UNCERTAIN, still goes to Review (no auto-create)", async () => {
    const supabase = makeFakeSupabase({ automation_settings: [{ whatsapp_auto_enabled: true }] });
    const ai = fakeAIProvider({
      relevance: "UNCERTAIN",
      classification: "ACTION",
      next_action: "Mandar el precio",
      suggested_contact: "Juan",
      confidence: "HIGH",
    });
    const entry = await processZapiaConversation({ supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" }, unit());
    expect(entry.outcome).toBe("review_created");
    expect(supabase.tables.work_item).toHaveLength(0);
  });

  it("with whatsapp_auto_enabled=true, auto-updates only a previously-empty safe field on the matched Work Item", async () => {
    const supabase = makeFakeSupabase({
      automation_settings: [{ whatsapp_auto_enabled: true }],
      work_item: [
        {
          id: "wi-1",
          title: "Cliente A - Trafo",
          status: "OPEN",
          next_action: null,
          waiting_for_what: null,
          expected_date: null,
          due_date: null,
          committed_date: null,
        },
      ],
      source_link: [{ id: "sl-1", work_item_id: "wi-1", source_type: "WHATSAPP", external_id: "chat-1", occurred_at: "2026-08-01" }],
    });
    const ai = fakeAIProvider({ relevance: "WORK", classification: "ACTION", next_action: "Mandar el precio", confidence: "HIGH" });
    const entry = await processZapiaConversation({ supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" }, unit());
    expect(entry.outcome).toBe("auto_updated");
    const updated = supabase.tables.work_item.find((w) => w.id === "wi-1");
    expect(updated?.next_action).toBe("Mandar el precio");
    const logRows = supabase.tables.ai_action_log;
    expect(logRows).toHaveLength(1);
    expect(logRows[0]?.action).toBe("UPDATE");
    expect(logRows[0]?.changed_fields).toEqual(["next_action"]);
  });

  it("with whatsapp_auto_enabled=true, never overwrites a field that already has a different value — falls back to Review", async () => {
    const supabase = makeFakeSupabase({
      automation_settings: [{ whatsapp_auto_enabled: true }],
      work_item: [
        {
          id: "wi-1",
          title: "Cliente A - Trafo",
          status: "OPEN",
          next_action: "Accion original",
          waiting_for_what: null,
          expected_date: null,
          due_date: null,
          committed_date: null,
        },
      ],
      source_link: [{ id: "sl-1", work_item_id: "wi-1", source_type: "WHATSAPP", external_id: "chat-1", occurred_at: "2026-08-01" }],
    });
    const ai = fakeAIProvider({ relevance: "WORK", classification: "ACTION", next_action: "Accion distinta", confidence: "HIGH" });
    const entry = await processZapiaConversation({ supabase: supabase as any, aiProvider: ai, todayISO: "2026-08-10" }, unit());
    expect(entry.outcome).toBe("review_created");
    const untouched = supabase.tables.work_item.find((w) => w.id === "wi-1");
    expect(untouched?.next_action).toBe("Accion original");
  });
});
