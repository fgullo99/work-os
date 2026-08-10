import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { SourceType, WorkItemRow } from "@/lib/supabase/types";
import { computePriority, type PriorityResult } from "@/lib/engine/priority";
import { computeRisk, type RiskResult } from "@/lib/engine/risk";
import { logCorrections, logCorrectionsOnUpdate } from "./correctionLog";
import type { CreateWorkItemInput, WorkItemWithRelations } from "./types";

type DB = SupabaseServerClient;

const RELATIONS_SELECT = `
  *,
  company:company_id ( id, name ),
  context:context_id ( id, title ),
  contact:contact_id ( id, name, tier ),
  waiting_for_contact:waiting_for_contact_id ( id, name ),
  responsible:responsible_id ( id, name )
`;

/**
 * "Barre" los Work Items pospuestos cuya fecha ya llego y los vuelve a poner OPEN.
 * Se ejecuta al leer el dashboard (no hace falta cron para esto en V1, ver spec seccion 6).
 */
export async function reactivatePostponedItems(supabase: DB, todayISO: string): Promise<void> {
  const { error } = await supabase
    .from("work_item")
    .update({ status: "OPEN", postponed_until: null })
    .eq("status", "POSTPONED")
    .lte("postponed_until", todayISO);
  if (error) throw error;
}

export interface LatestSourceInfo {
  source_type: SourceType;
  raw_excerpt: string | null;
  occurred_at: string;
  external_url: string | null;
  /** Proveedor tecnico detras de la fuente (ej. "Zapia" detras de WHATSAPP), derivado de
   * raw_metadata.provider. Null si no aplica. */
  via: string | null;
}

/** raw_metadata.provider -> nombre "lindo" para el SourceBadge. Solo Zapia por ahora. */
function providerToVia(rawMetadata: Record<string, unknown> | null): string | null {
  const provider = rawMetadata?.provider;
  if (provider === "zapia") return "Zapia";
  return null;
}

/** Trae, para cada work_item_id dado, el source_link mas reciente (para mostrar
 * "de donde vino" + un extracto en las cards del dashboard). Query adicional, no toca
 * ninguna de las funciones de escritura existentes. */
async function getLatestSourceByWorkItem(supabase: DB, workItemIds: string[]): Promise<Map<string, LatestSourceInfo>> {
  const map = new Map<string, LatestSourceInfo>();
  if (workItemIds.length === 0) return map;

  const { data, error } = await supabase
    .from("source_link")
    .select("work_item_id, source_type, raw_excerpt, occurred_at, external_url, raw_metadata")
    .in("work_item_id", workItemIds)
    .order("occurred_at", { ascending: false });
  if (error) throw error;

  type Row = {
    work_item_id: string;
    source_type: SourceType;
    raw_excerpt: string | null;
    occurred_at: string;
    external_url: string | null;
    raw_metadata: Record<string, unknown> | null;
  };
  for (const row of (data ?? []) as Row[]) {
    if (!map.has(row.work_item_id)) {
      map.set(row.work_item_id, {
        source_type: row.source_type,
        raw_excerpt: row.raw_excerpt,
        occurred_at: row.occurred_at,
        external_url: row.external_url,
        via: providerToVia(row.raw_metadata),
      });
    }
  }
  return map;
}

export interface RecentActivityRow {
  id: string;
  work_item_id: string;
  source_type: SourceType;
  raw_excerpt: string | null;
  occurred_at: string;
  work_item_title: string;
  via: string | null;
  is_demo: boolean;
}

/** Ultimos eventos reales (source_link) para el panel "Actividad reciente". Como los
 * threads descartados por el rule filter de Gmail nunca llegan a persistirse como
 * source_link, esta lista ya excluye newsletters/ruido por construccion. */
export async function getRecentActivity(supabase: DB, limit = 6): Promise<RecentActivityRow[]> {
  const { data, error } = await supabase
    .from("source_link")
    .select("id, work_item_id, source_type, raw_excerpt, occurred_at, raw_metadata, is_demo, work_item:work_item_id ( title )")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  type Row = {
    id: string;
    work_item_id: string;
    source_type: SourceType;
    raw_excerpt: string | null;
    occurred_at: string;
    raw_metadata: Record<string, unknown> | null;
    is_demo: boolean;
    work_item: { title: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    work_item_id: row.work_item_id,
    source_type: row.source_type,
    raw_excerpt: row.raw_excerpt,
    occurred_at: row.occurred_at,
    work_item_title: row.work_item?.title ?? "",
    via: providerToVia(row.raw_metadata),
    is_demo: row.is_demo,
  }));
}

export interface DashboardData {
  todayItems: Array<WorkItemWithRelations & { priority: PriorityResult; latestSource: LatestSourceInfo | null }>;
  atRiskItems: Array<WorkItemWithRelations & { risk: RiskResult; latestSource: LatestSourceInfo | null }>;
  waitingForItems: Array<WorkItemWithRelations & { latestSource: LatestSourceInfo | null }>;
  counts: { today: number; atRisk: number; waiting: number };
}

export async function getDashboardData(supabase: DB, todayISO: string): Promise<DashboardData> {
  await reactivatePostponedItems(supabase, todayISO);

  const { data, error } = await supabase
    .from("work_item")
    .select(RELATIONS_SELECT)
    .in("status", ["OPEN", "DELEGATED"]);

  if (error) throw error;
  const items = (data ?? []) as unknown as WorkItemWithRelations[];

  const priorityCandidates = items
    .filter((item) => item.status === "OPEN")
    .map((item) => ({
      item,
      priority: computePriority(item, { todayISO, contactTier: item.contact?.tier ?? null }),
    }));

  const todayItemsRaw = priorityCandidates
    .filter(({ priority }) => priority.bucket === "DO_NOW" || priority.bucket === "TODAY")
    .sort((a, b) => b.priority.score - a.priority.score)
    .slice(0, 5)
    .map(({ item, priority }) => ({ ...item, priority }));

  const atRiskItemsRaw = items
    .map((item) => ({ item, risk: computeRisk(item, todayISO) }))
    .filter(({ risk }) => risk.isAtRisk)
    .sort((a, b) => b.risk.reasons.length - a.risk.reasons.length)
    .map(({ item, risk }) => ({ ...item, risk }));

  const waitingForItemsRaw = items
    .filter((item) => item.waiting_for_what)
    .sort((a, b) => (a.expected_date ?? "9999-12-31").localeCompare(b.expected_date ?? "9999-12-31"));

  const allIds = Array.from(
    new Set([...todayItemsRaw, ...atRiskItemsRaw, ...waitingForItemsRaw].map((item) => item.id))
  );
  const latestSourceMap = await getLatestSourceByWorkItem(supabase, allIds);

  const todayItems = todayItemsRaw.map((item) => ({ ...item, latestSource: latestSourceMap.get(item.id) ?? null }));
  const atRiskItems = atRiskItemsRaw.map((item) => ({ ...item, latestSource: latestSourceMap.get(item.id) ?? null }));
  const waitingForItems = waitingForItemsRaw.map((item) => ({
    ...item,
    latestSource: latestSourceMap.get(item.id) ?? null,
  }));

  return {
    todayItems,
    atRiskItems,
    waitingForItems,
    counts: { today: todayItems.length, atRisk: atRiskItems.length, waiting: waitingForItems.length },
  };
}

export async function createWorkItem(supabase: DB, input: CreateWorkItemInput): Promise<WorkItemRow> {
  const { data: workItem, error } = await supabase
    .from("work_item")
    .insert({
      title: input.title,
      context_id: input.context_id,
      company_id: input.company_id,
      contact_id: input.contact_id,
      category: input.category,
      next_action: input.next_action,
      waiting_for_what: input.waiting_for_what,
      waiting_for_contact_id: input.waiting_for_contact_id,
      due_date: input.due_date,
      expected_date: input.expected_date,
      committed_date: input.committed_date,
      blocking: input.blocking,
      blocking_note: input.blocking_note,
      estimated_minutes: input.estimated_minutes,
      ai_summary: input.ai_summary,
      ai_confidence: input.ai_confidence,
      status: "OPEN",
    })
    .select()
    .single();

  if (error) throw error;

  const { error: sourceError } = await supabase.from("source_link").insert({
    work_item_id: workItem.id,
    source_type: "MANUAL",
    raw_excerpt: input.rawText,
    direction: null,
    occurred_at: new Date().toISOString(),
  });
  if (sourceError) throw sourceError;

  if (input.aiOriginal) {
    await logCorrections(supabase, workItem.id, input.aiOriginal, workItem as WorkItemRow);
  }

  return workItem as WorkItemRow;
}

export async function getWorkItem(supabase: DB, id: string): Promise<WorkItemWithRelations> {
  const { data, error } = await supabase.from("work_item").select(RELATIONS_SELECT).eq("id", id).single();
  if (error) throw error;
  return data as unknown as WorkItemWithRelations;
}

export async function getWorkItemSources(supabase: DB, workItemId: string) {
  const { data, error } = await supabase
    .from("source_link")
    .select("*")
    .eq("work_item_id", workItemId)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getWorkItemNotes(supabase: DB, workItemId: string) {
  const { data, error } = await supabase
    .from("note")
    .select("*")
    .eq("work_item_id", workItemId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Update generico para edicion manual. Registra correction_log si el item vino de IA. */
export async function updateWorkItem(
  supabase: DB,
  id: string,
  patch: Partial<WorkItemRow>
): Promise<WorkItemRow> {
  const { data: before, error: fetchError } = await supabase.from("work_item").select("*").eq("id", id).single();
  if (fetchError) throw fetchError;

  const { data: after, error } = await supabase
    .from("work_item")
    .update({ ...patch, last_activity_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  await logCorrectionsOnUpdate(supabase, id, before as WorkItemRow, after as WorkItemRow, Object.keys(patch));

  return after as WorkItemRow;
}

async function setStatus(supabase: DB, id: string, patch: Partial<WorkItemRow>): Promise<WorkItemRow> {
  const { data, error } = await supabase
    .from("work_item")
    .update({ ...patch, last_activity_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as WorkItemRow;
}

export function markDone(supabase: DB, id: string) {
  return setStatus(supabase, id, { status: "DONE" });
}

export function reopenWorkItem(supabase: DB, id: string) {
  return setStatus(supabase, id, { status: "OPEN" });
}

export function ignoreWorkItem(supabase: DB, id: string) {
  return setStatus(supabase, id, { status: "IGNORED" });
}

export function postponeWorkItem(supabase: DB, id: string, untilISO: string) {
  return setStatus(supabase, id, { status: "POSTPONED", postponed_until: untilISO });
}

export async function delegateWorkItem(
  supabase: DB,
  id: string,
  responsibleId: string,
  expectedDateISO: string
): Promise<WorkItemRow> {
  const { data: current, error: fetchError } = await supabase.from("work_item").select("*").eq("id", id).single();
  if (fetchError) throw fetchError;

  const waitingWhat = current.next_action ?? current.title;
  return setStatus(supabase, id, {
    status: "DELEGATED",
    responsible_id: responsibleId,
    waiting_for_contact_id: responsibleId,
    waiting_for_what: `Delegado: ${waitingWhat}`,
    expected_date: expectedDateISO,
  });
}

/**
 * RECEIVED: limpia la espera. NO cierra el Work Item si todavia queda next_action
 * pendiente (spec seccion 21/26 y criterio de aceptacion 12).
 */
export async function receiveWaiting(supabase: DB, id: string): Promise<WorkItemRow> {
  const { data: current, error: fetchError } = await supabase.from("work_item").select("*").eq("id", id).single();
  if (fetchError) throw fetchError;

  const nextStatus = current.status === "DELEGATED" ? "OPEN" : current.status;
  return setStatus(supabase, id, {
    status: nextStatus,
    waiting_for_what: null,
    waiting_for_contact_id: null,
    expected_date: null,
    follow_up_date: null,
  });
}

export async function extendWaiting(supabase: DB, id: string, newExpectedDateISO: string): Promise<WorkItemRow> {
  return setStatus(supabase, id, { expected_date: newExpectedDateISO });
}

export async function addNote(supabase: DB, workItemId: string, body: string): Promise<void> {
  const { error } = await supabase.from("note").insert({ work_item_id: workItemId, body });
  if (error) throw error;
  await setStatus(supabase, workItemId, {});
}

export async function searchWorkItems(supabase: DB, query: string): Promise<WorkItemWithRelations[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const q = `%${trimmed}%`;

  const [companies, contacts, contexts] = await Promise.all([
    supabase.from("company").select("id").ilike("name", q),
    supabase.from("contact").select("id").ilike("name", q),
    supabase.from("context").select("id").ilike("title", q),
  ]);

  const companyIds = (companies.data ?? []).map((c) => c.id);
  const contactIds = (contacts.data ?? []).map((c) => c.id);
  const contextIds = (contexts.data ?? []).map((c) => c.id);

  const orParts = [`title.ilike.${q}`, `next_action.ilike.${q}`, `waiting_for_what.ilike.${q}`];
  if (companyIds.length) orParts.push(`company_id.in.(${companyIds.join(",")})`);
  if (contactIds.length) orParts.push(`contact_id.in.(${contactIds.join(",")})`);
  if (contextIds.length) orParts.push(`context_id.in.(${contextIds.join(",")})`);

  const { data, error } = await supabase
    .from("work_item")
    .select(RELATIONS_SELECT)
    .or(orParts.join(","))
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []) as unknown as WorkItemWithRelations[];
}
