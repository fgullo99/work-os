import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaseRow, CaseSourceLinkRow, SourceDirection, SourceType } from "@/lib/supabase/types";

type DB = SupabaseClient;

export interface CreateCaseInput {
  title: string;
  companyId: string | null;
  contactId: string | null;
  contextId: string | null;
  referenceType: string | null;
  referenceValue: string | null;
}

export async function createCase(supabase: DB, input: CreateCaseInput): Promise<CaseRow> {
  const { data, error } = await supabase
    .from("case")
    .insert({
      title: input.title,
      company_id: input.companyId,
      contact_id: input.contactId,
      context_id: input.contextId,
      reference_type: input.referenceType,
      reference_value: input.referenceValue,
    })
    .select()
    .single();
  if (error) throw error;
  return data as CaseRow;
}

export async function getCase(supabase: DB, id: string): Promise<CaseRow | null> {
  const { data, error } = await supabase.from("case").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as CaseRow | null) ?? null;
}

export async function getCaseSources(supabase: DB, caseId: string): Promise<CaseSourceLinkRow[]> {
  const { data, error } = await supabase
    .from("case_source_link")
    .select("*")
    .eq("case_id", caseId)
    .order("occurred_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CaseSourceLinkRow[];
}

/** Regla #1 de matching de Case (la mas fuerte, identica en espiritu a
 * findWorkItemByThreadId): mismo Gmail thread ya vinculado = mismo Case. Se chequea ANTES de
 * intentar matchCaseForThread — evita re-matchear y evita duplicar case_source_link gracias
 * a la idempotencia por mensaje (ver getExistingCaseSourceMessageIds). Dos queries simples en
 * vez de un embedded join de Postgrest — mas facil de testear y menos fragil entre versiones. */
export async function findCaseByThreadId(supabase: DB, threadId: string): Promise<CaseRow | null> {
  const { data, error } = await supabase
    .from("case_source_link")
    .select("case_id")
    .eq("source_type", "GMAIL")
    .eq("external_id", threadId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const caseId = (data as { case_id: string } | null)?.case_id;
  if (!caseId) return null;
  return getCase(supabase, caseId);
}

/** Cases abiertos (current_state != CLOSED) — el pool candidato para matchCaseForThread.
 * Escaneado por company_id cuando se conoce (nunca la tabla entera sin acotar, ver plan). */
export async function listOpenCases(supabase: DB, companyId: string | null): Promise<CaseRow[]> {
  let query = supabase.from("case").select("*").neq("current_state", "CLOSED");
  if (companyId) query = query.eq("company_id", companyId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as CaseRow[];
}

export interface AddCaseSourceLinkInput {
  caseId: string;
  sourceType: SourceType;
  externalId: string | null;
  externalMessageId: string | null;
  externalUrl: string | null;
  rawExcerpt: string | null;
  rawMetadata: Record<string, unknown> | null;
  direction: SourceDirection | null;
  eventLabel: string | null;
  occurredAt: string;
}

export async function addCaseSourceLink(supabase: DB, input: AddCaseSourceLinkInput): Promise<void> {
  const { error } = await supabase.from("case_source_link").insert({
    case_id: input.caseId,
    source_type: input.sourceType,
    external_id: input.externalId,
    external_message_id: input.externalMessageId,
    external_url: input.externalUrl,
    raw_excerpt: input.rawExcerpt,
    raw_metadata: input.rawMetadata,
    direction: input.direction,
    event_label: input.eventLabel,
    occurred_at: input.occurredAt,
  });
  if (error) throw error;
}

/** IDs de mensaje de Gmail ya vinculados a este Case para este thread — un row por MENSAJE
 * (no por thread, ver nota en schema_case_phase2.sql), asi el timeline muestra cada evento
 * por separado. Reprocesar el mismo thread solo agrega los mensajes nuevos, nunca duplica. */
export async function getExistingCaseSourceMessageIds(supabase: DB, caseId: string, threadId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("case_source_link")
    .select("external_message_id")
    .eq("case_id", caseId)
    .eq("external_id", threadId)
    .eq("source_type", "GMAIL");
  if (error) throw error;
  return new Set(
    ((data ?? []) as Array<{ external_message_id: string | null }>).map((r) => r.external_message_id).filter((v): v is string => Boolean(v))
  );
}

export interface UpdateCaseStatePatch {
  title?: string;
  referenceType?: string | null;
  referenceValue?: string | null;
  currentState: string;
  currentOwner: string;
  felipeActionRequired: boolean;
  nextAction: string | null;
  waitingFor: string | null;
  responsible: string | null;
  dueDate: string | null;
  expectedDate: string | null;
  risk: string;
  confidence: string;
  aiSummary: string;
  lastMeaningfulEvent: string;
  /** Se SUMAN al acumulado existente (telemetria de costo), nunca se pisan. */
  addAiCalls: number;
  addAiInputTokens: number;
  addAiOutputTokens: number;
}

export async function updateCaseState(supabase: DB, caseId: string, current: CaseRow, patch: UpdateCaseStatePatch): Promise<void> {
  const { error } = await supabase
    .from("case")
    .update({
      title: patch.title ?? current.title,
      reference_type: patch.referenceType ?? current.reference_type,
      reference_value: patch.referenceValue ?? current.reference_value,
      current_state: patch.currentState,
      current_owner: patch.currentOwner,
      felipe_action_required: patch.felipeActionRequired,
      next_action: patch.nextAction,
      waiting_for: patch.waitingFor,
      responsible: patch.responsible,
      due_date: patch.dueDate,
      expected_date: patch.expectedDate,
      risk: patch.risk,
      confidence: patch.confidence,
      ai_summary: patch.aiSummary,
      last_meaningful_event: patch.lastMeaningfulEvent,
      last_activity_at: new Date().toISOString(),
      ai_calls_count: current.ai_calls_count + patch.addAiCalls,
      ai_input_tokens: current.ai_input_tokens + patch.addAiInputTokens,
      ai_output_tokens: current.ai_output_tokens + patch.addAiOutputTokens,
    })
    .eq("id", caseId);
  if (error) throw error;
}
