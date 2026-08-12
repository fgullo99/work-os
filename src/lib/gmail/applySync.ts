import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiConfidence, ReviewItemKind, WorkItemRow } from "@/lib/supabase/types";
import type { AIProvider, EmailThreadResult } from "@/lib/ai";
import type { NormalizedMessage, NormalizedThread } from "./types";
import { applyRuleFilter } from "./ruleFilter";
import { findDuplicateCandidates, findWorkItemByThreadId } from "./workItemMatch";
import { decideAction, type ActionPlan, type ResolvedClassification } from "./decisionEngine";
import { resolveDatePhrase } from "@/lib/dates/resolveDatePhrase";
import { findBestMatch } from "@/lib/workItems/match";
import { createCompany, createContact, createContext, listCompanies, listContacts, listContexts } from "@/lib/workItems/entities";
import { isAutoCreateEligible, classifyAutoUpdate } from "@/lib/engine/automationGate";
import { logAiAction } from "@/lib/engine/aiActionLog";

type DB = SupabaseClient;

export interface ThreadSyncLogEntry {
  threadId: string;
  subject: string;
  ruleFilterSkipped: boolean;
  ruleFilterReason: string | null;
  llmCalled: boolean;
  relevance: string | null;
  classification: string | null;
  confidence: string | null;
  isDelegation: boolean | null;
  attentionOwner: string | null;
  teamOtherRelation: string | null;
  action: string;
  /** Solo se llena cuando processThread corre desde el AI Work Manager (reconciliacion o
   * discovery, ver reconcile.ts) en vez del sync incremental normal — permite armar el
   * reporte "previous state / AI interpretation / resulting state" sin tocar el pipeline. */
  existingWorkItemId?: string | null;
  resultingWorkItemId?: string | null;
  rationale?: string | null;
}

export interface ApplySyncDeps {
  supabase: DB;
  aiProvider: AIProvider;
  todayISO: string;
  /** google_connection.safe_mode, unica fuente de verdad de "AI Automation" para Gmail
   * (ver Settings → AI Automation). safe_mode=true es el kill switch manual: fuerza Review
   * siempre, sin importar el gate estructural. safe_mode=false habilita auto-apply, pero
   * solo para lo que ademas pase isAutoCreateEligible/classifyAutoUpdate (ver
   * src/lib/engine/automationGate.ts). */
  safeMode: boolean;
  /** Direcciones de la cuenta conectada — se le pasan al Normalizer para que pueda comparar
   * contra To/Cc de cada mensaje y determinar attention_owner (ver emailPrompt.ts). */
  userAddresses: string[];
}

export interface AutomationGateContext {
  /** Solo se evalua si plan.type === "CREATE_WORK_ITEM". */
  createEligible: boolean;
  /** Solo se evalua si plan.type === "UPDATE_WORK_ITEM_SAFE". */
  updateDecision: "AUTO_SAFE" | "REVIEW";
}

/**
 * Aplica el gate de automatizacion sobre el plan ya decidido por decideAction(): con
 * safe_mode=true (kill switch), todo lo que hubiera creado/actualizado pasa a Review sin
 * excepcion. Con safe_mode=false, ademas hace falta pasar el gate estructural
 * (isAutoCreateEligible / classifyAutoUpdate) para auto-aplicar — si no lo pasa, tambien
 * cae a Review. Pura y sin dependencias — decideAction() sigue sin saber nada de esto.
 */
export function applyAutomationGate(
  plan: ActionPlan,
  safeMode: boolean,
  gate: AutomationGateContext
): { plan: ActionPlan; actionLabel: string } {
  if (safeMode) {
    if (plan.type === "CREATE_WORK_ITEM") {
      return { plan: { type: "REVIEW_NEW_WORK_ITEM" }, actionLabel: "WOULD_CREATE (automation off)" };
    }
    if (plan.type === "UPDATE_WORK_ITEM_SAFE") {
      return {
        plan: { type: "REVIEW_UPDATE_WORK_ITEM", workItemId: plan.workItemId },
        actionLabel: "WOULD_UPDATE (automation off)",
      };
    }
    return { plan, actionLabel: plan.type };
  }

  if (plan.type === "CREATE_WORK_ITEM") {
    if (gate.createEligible) return { plan, actionLabel: "AUTO_CREATE" };
    return { plan: { type: "REVIEW_NEW_WORK_ITEM" }, actionLabel: "REVIEW (below auto-create threshold)" };
  }
  if (plan.type === "UPDATE_WORK_ITEM_SAFE") {
    if (gate.updateDecision === "AUTO_SAFE") return { plan, actionLabel: "AUTO_UPDATE" };
    return {
      plan: { type: "REVIEW_UPDATE_WORK_ITEM", workItemId: plan.workItemId },
      actionLabel: "REVIEW (update fuera de la lista segura)",
    };
  }
  return { plan, actionLabel: plan.type };
}

/** Procesa UN thread de punta a punta: rule filter -> normalizer -> matching -> decision -> DB. */
export async function processThread(deps: ApplySyncDeps, thread: NormalizedThread): Promise<ThreadSyncLogEntry> {
  const log: ThreadSyncLogEntry = {
    threadId: thread.threadId,
    subject: thread.subject,
    ruleFilterSkipped: false,
    ruleFilterReason: null,
    llmCalled: false,
    relevance: null,
    classification: null,
    confidence: null,
    isDelegation: null,
    attentionOwner: null,
    teamOtherRelation: null,
    action: "",
  };

  const ruleResult = applyRuleFilter(thread);
  if (ruleResult.skip) {
    log.ruleFilterSkipped = true;
    log.ruleFilterReason = ruleResult.reason;
    log.action = "IGNORE (rule filter)";
    return log;
  }

  const existingWorkItem = await findWorkItemByThreadId(deps.supabase, thread.threadId);

  log.llmCalled = true;
  const raw = await deps.aiProvider.normalizeEmailThread({
    thread,
    existingWorkItem: existingWorkItem
      ? {
          id: existingWorkItem.id,
          title: existingWorkItem.title,
          status: existingWorkItem.status,
          next_action: existingWorkItem.next_action,
          waiting_for_what: existingWorkItem.waiting_for_what,
          expected_date: existingWorkItem.expected_date,
          due_date: existingWorkItem.due_date,
          committed_date: existingWorkItem.committed_date,
        }
      : null,
    currentDateISO: deps.todayISO,
    userAddresses: deps.userAddresses,
  });

  log.relevance = raw.relevance;
  log.classification = raw.classification;
  log.confidence = raw.confidence;
  log.isDelegation = raw.is_delegation;
  log.attentionOwner = raw.attention_owner;
  log.teamOtherRelation = raw.team_other_relation;
  log.existingWorkItemId = existingWorkItem?.id ?? null;
  log.rationale = raw.rationale;

  const resolved: ResolvedClassification = {
    relevance: raw.relevance,
    classification: raw.classification,
    attentionOwner: raw.attention_owner,
    teamOtherRelation: raw.team_other_relation,
    next_action: raw.next_action,
    waiting_for_what: raw.waiting_for_what,
    due_date: resolveDatePhrase(raw.due_date_phrase, deps.todayISO),
    expected_date: resolveDatePhrase(raw.expected_date_phrase, deps.todayISO),
    committed_date: resolveDatePhrase(raw.committed_date_phrase, deps.todayISO),
    confidence: raw.confidence,
  };

  const latestMessage = thread.messages[thread.messages.length - 1];
  const lastMessageIsOutbound = latestMessage?.direction === "OUTBOUND";

  const referenceActivity = existingWorkItem?.last_activity_at ?? null;
  const hasNewInboundSinceLastSync = thread.messages.some(
    (m) => m.direction === "INBOUND" && (!referenceActivity || m.date > referenceActivity)
  );

  let duplicateCandidateIds: string[] = [];
  if (!existingWorkItem) {
    const [companies, contacts, contexts] = await Promise.all([
      listCompanies(deps.supabase),
      listContacts(deps.supabase),
      listContexts(deps.supabase),
    ]);
    const companyMatch = findBestMatch(companies, raw.suggested_company);
    const contactMatch = findBestMatch(contacts, raw.suggested_contact ?? raw.waiting_for_person);
    const contextMatch = findBestMatch(contexts, raw.suggested_context);

    const candidates = await findDuplicateCandidates(deps.supabase, {
      title: raw.suggested_context ?? thread.subject,
      contactId: contactMatch?.id ?? null,
      companyId: companyMatch?.id ?? null,
      contextId: contextMatch?.id ?? null,
    });
    duplicateCandidateIds = candidates.map((c) => c.id);
  }

  const rawPlan = decideAction({
    classification: resolved,
    existingWorkItem,
    duplicateCandidateIds,
    hasNewInboundSinceLastSync,
    lastMessageIsOutbound,
  });

  const createEligible = isAutoCreateEligible({
    relevance: raw.relevance,
    confidence: raw.confidence,
    hasClearActor: Boolean(raw.suggested_contact || raw.waiting_for_person),
    hasClearAction: Boolean(resolved.next_action || resolved.waiting_for_what),
    directionConsistent: true, // Gmail siempre tiene direccion INBOUND/OUTBOUND determinada por header, nunca "unknown"
    hasAmbiguousMatch: duplicateCandidateIds.length > 1,
  });
  const updateDecision =
    rawPlan.type === "UPDATE_WORK_ITEM_SAFE"
      ? classifyAutoUpdate({
          relevance: raw.relevance,
          confidence: raw.confidence,
          changedFields: rawPlan.fieldsToFill,
          matchUnambiguous: true, // findWorkItemByThreadId es un match exacto por thread_id, no fuzzy
        })
      : "REVIEW";

  const { plan, actionLabel } = applyAutomationGate(rawPlan, deps.safeMode, { createEligible, updateDecision });
  log.action = actionLabel;

  switch (plan.type) {
    case "IGNORE":
      break;

    case "NO_OP": {
      // Hubo actividad en el thread pero no cambia el estado del Work Item (ej. un "sigo
      // esperando" repetido). Se refresca last_activity_at/ai_summary y se deja evidencia
      // (source_link) de que se reviso, pero sin ai_action_log — no hay nada que un Undo
      // pueda revertir porque no se cambio ningun campo de negocio.
      log.resultingWorkItemId = plan.workItemId;
      const { error } = await deps.supabase
        .from("work_item")
        .update({
          last_activity_at: new Date().toISOString(),
          last_message_direction: latestMessage?.direction ?? null,
          ai_summary: raw.summary,
        })
        .eq("id", plan.workItemId);
      if (error) throw error;
      await createSourceLinkForThread(deps.supabase, plan.workItemId, thread, latestMessage);
      break;
    }

    case "RECEIVED_CHECK":
      log.resultingWorkItemId = plan.workItemId;
      await upsertReviewItem(deps.supabase, {
        kind: "RECEIVED_CHECK",
        workItemId: plan.workItemId,
        proposedPayload: { note: "Hubo actividad nueva en el thread. Revisa si resuelve lo que estabas esperando." },
        confidence: raw.confidence,
        rationale: raw.rationale,
        evidence: raw.evidence,
        thread,
        latestMessage,
      });
      break;

    case "CREATE_WORK_ITEM": {
      const ids = await resolveOrCreateEntities(deps.supabase, raw);
      const workItem = await createWorkItemFromGmail(deps.supabase, thread, raw, resolved, ids, latestMessage);
      log.resultingWorkItemId = workItem.id;
      await createSourceLinkForThread(deps.supabase, workItem.id, thread, latestMessage);
      if (actionLabel === "AUTO_CREATE") {
        await logAiAction(deps.supabase, {
          sourceType: "GMAIL",
          action: "CREATE",
          workItemId: workItem.id,
          confidence: raw.confidence,
          relevance: raw.relevance,
          reasoning: raw.rationale,
          changedFields: [],
          beforeValues: {},
          afterValues: { title: workItem.title },
        });
      }
      break;
    }

    case "UPDATE_WORK_ITEM_SAFE": {
      log.resultingWorkItemId = plan.workItemId;
      const patch: Record<string, unknown> = {
        last_activity_at: new Date().toISOString(),
        last_message_direction: latestMessage?.direction ?? null,
        ai_summary: raw.summary,
      };
      const beforeValues: Record<string, unknown> = {};
      const afterValues: Record<string, unknown> = {};
      for (const field of plan.fieldsToFill) {
        patch[field] = resolved[field];
        beforeValues[field] = existingWorkItem ? existingWorkItem[field] : null;
        afterValues[field] = resolved[field];
      }
      const { error } = await deps.supabase.from("work_item").update(patch).eq("id", plan.workItemId);
      if (error) throw error;
      await createSourceLinkForThread(deps.supabase, plan.workItemId, thread, latestMessage);
      if (actionLabel === "AUTO_UPDATE") {
        await logAiAction(deps.supabase, {
          sourceType: "GMAIL",
          action: "UPDATE",
          workItemId: plan.workItemId,
          confidence: raw.confidence,
          relevance: raw.relevance,
          reasoning: raw.rationale,
          changedFields: plan.fieldsToFill,
          beforeValues,
          afterValues,
        });
      }
      break;
    }

    case "REVIEW_NEW_WORK_ITEM":
      await upsertReviewItem(deps.supabase, {
        kind: "NEW_WORK_ITEM",
        workItemId: null,
        proposedPayload: buildProposedPayload(raw, resolved, thread),
        confidence: raw.confidence,
        rationale: raw.rationale,
        evidence: raw.evidence,
        thread,
        latestMessage,
      });
      break;

    case "REVIEW_UPDATE_WORK_ITEM":
      log.resultingWorkItemId = plan.workItemId;
      await upsertReviewItem(deps.supabase, {
        kind: "UPDATE_WORK_ITEM",
        workItemId: plan.workItemId,
        proposedPayload: buildProposedPayload(raw, resolved, thread),
        confidence: raw.confidence,
        rationale: raw.rationale,
        evidence: raw.evidence,
        thread,
        latestMessage,
      });
      break;

    case "REVIEW_POTENTIAL_COMMITMENT":
      await upsertReviewItem(deps.supabase, {
        kind: "POTENTIAL_COMMITMENT",
        workItemId: null,
        proposedPayload: buildProposedPayload(raw, resolved, thread),
        confidence: raw.confidence,
        rationale: raw.rationale,
        evidence: raw.evidence,
        thread,
        latestMessage,
      });
      break;

    case "REVIEW_POSSIBLE_DUPLICATE":
      await upsertReviewItem(deps.supabase, {
        kind: "POSSIBLE_DUPLICATE",
        workItemId: null,
        duplicateCandidateIds: plan.candidateIds,
        proposedPayload: buildProposedPayload(raw, resolved, thread),
        confidence: raw.confidence,
        rationale: raw.rationale,
        evidence: raw.evidence,
        thread,
        latestMessage,
      });
      break;
  }

  return log;
}

function buildProposedPayload(raw: EmailThreadResult, resolved: ResolvedClassification, thread: NormalizedThread) {
  return {
    title: raw.suggested_context || thread.subject,
    next_action: resolved.next_action,
    waiting_for_what: resolved.waiting_for_what,
    waiting_for_person: raw.waiting_for_person,
    due_date: resolved.due_date,
    expected_date: resolved.expected_date,
    committed_date: resolved.committed_date,
    suggested_company: raw.suggested_company,
    suggested_contact: raw.suggested_contact,
    suggested_context: raw.suggested_context,
    suggested_category: raw.suggested_category,
    blocking: raw.blocking,
    is_delegation: raw.is_delegation,
    classification: raw.classification,
    attention_owner: raw.attention_owner,
    team_other_relation: raw.team_other_relation,
  };
}

export interface EntitySuggestions {
  suggested_company: string | null;
  suggested_contact: string | null;
  waiting_for_person: string | null;
  suggested_context: string | null;
}

/**
 * Resuelve nombres sugeridos (texto libre) a IDs de Company/Contact/Context existentes, o
 * los crea si no hay match. Exportada para reusarse desde src/lib/workItems/reviewItems.ts:
 * cuando el usuario ACEPTA/APLICA una sugerencia de Review, la creacion de entidades pasa
 * por aca recien en ese momento — nunca antes, sin que un humano confirme (ver comentario
 * en processThread: los caminos de REVIEW nunca crean Company/Contact/Context solos).
 */
export async function resolveOrCreateEntities(supabase: DB, raw: EntitySuggestions) {
  const [companies, contacts, contexts] = await Promise.all([listCompanies(supabase), listContacts(supabase), listContexts(supabase)]);

  let companyId: string | null = null;
  if (raw.suggested_company) {
    const match = findBestMatch(companies, raw.suggested_company);
    companyId = match ? match.id : (await createCompany(supabase, { name: raw.suggested_company })).id;
  }

  const personCache = new Map<string, string>();
  async function resolvePerson(name: string | null): Promise<string | null> {
    if (!name) return null;
    const key = name.trim().toLowerCase();
    if (!key) return null;
    if (personCache.has(key)) return personCache.get(key) as string;
    const match = findBestMatch(contacts, name);
    const id = match ? match.id : (await createContact(supabase, { name, company_id: companyId })).id;
    personCache.set(key, id);
    return id;
  }

  const contactId = await resolvePerson(raw.suggested_contact);
  const waitingForContactId = await resolvePerson(raw.waiting_for_person);

  let contextId: string | null = null;
  if (raw.suggested_context) {
    const match = findBestMatch(contexts, raw.suggested_context);
    contextId = match ? match.id : (await createContext(supabase, { title: raw.suggested_context, company_id: companyId })).id;
  }

  return { companyId, contactId, waitingForContactId, contextId };
}

async function createWorkItemFromGmail(
  supabase: DB,
  thread: NormalizedThread,
  raw: EmailThreadResult,
  resolved: ResolvedClassification,
  ids: { companyId: string | null; contactId: string | null; waitingForContactId: string | null; contextId: string | null },
  latestMessage: NormalizedMessage | undefined
): Promise<WorkItemRow> {
  const title = raw.suggested_context || thread.subject || raw.summary.slice(0, 80);
  const { data, error } = await supabase
    .from("work_item")
    .insert({
      title,
      context_id: ids.contextId,
      company_id: ids.companyId,
      contact_id: ids.contactId,
      category: raw.suggested_category,
      next_action: resolved.next_action,
      waiting_for_what: resolved.waiting_for_what,
      waiting_for_contact_id: ids.waitingForContactId,
      due_date: resolved.due_date,
      expected_date: resolved.expected_date,
      committed_date: resolved.committed_date,
      blocking: raw.blocking,
      ai_summary: raw.summary,
      ai_confidence: raw.confidence,
      last_message_direction: latestMessage?.direction ?? null,
      status: "OPEN",
    })
    .select()
    .single();
  if (error) throw error;
  return data as WorkItemRow;
}

async function createSourceLinkForThread(
  supabase: DB,
  workItemId: string,
  thread: NormalizedThread,
  latestMessage: NormalizedMessage | undefined
): Promise<void> {
  const { error } = await supabase.from("source_link").insert({
    work_item_id: workItemId,
    source_type: "GMAIL",
    external_id: thread.threadId,
    external_url: thread.webUrl,
    raw_excerpt: (latestMessage?.bodyText || latestMessage?.snippet || "").slice(0, 500),
    raw_metadata: { message_id: latestMessage?.id ?? null, subject: thread.subject },
    direction: latestMessage?.direction ?? null,
    occurred_at: latestMessage?.date ?? new Date().toISOString(),
  });
  if (error) throw error;
}

interface UpsertReviewItemParams {
  kind: ReviewItemKind;
  workItemId: string | null;
  duplicateCandidateIds?: string[];
  proposedPayload: Record<string, unknown>;
  confidence: AiConfidence;
  rationale: string | null;
  evidence: string | null;
  thread: NormalizedThread;
  latestMessage: NormalizedMessage | undefined;
}

/** Si ya hay un review_item PENDING del mismo kind para el mismo thread, lo actualiza en vez
 * de duplicarlo (puede pasar si el thread recibe varios mensajes nuevos antes de que el
 * usuario revise la sugerencia anterior). */
async function upsertReviewItem(supabase: DB, params: UpsertReviewItemParams): Promise<void> {
  const fields = {
    kind: params.kind,
    work_item_id: params.workItemId,
    duplicate_candidate_ids: params.duplicateCandidateIds ?? null,
    proposed_payload: params.proposedPayload,
    confidence: params.confidence,
    rationale: params.rationale,
    evidence: params.evidence,
    source_type: "GMAIL" as const,
    external_id: params.thread.threadId,
    external_message_id: params.latestMessage?.id ?? null,
    external_url: params.thread.webUrl,
    raw_excerpt: (params.latestMessage?.bodyText || params.latestMessage?.snippet || "").slice(0, 500),
    raw_metadata: { subject: params.thread.subject },
    direction: params.latestMessage?.direction ?? null,
    occurred_at: params.latestMessage?.date ?? new Date().toISOString(),
  };

  const { data: existing, error: findError } = await supabase
    .from("review_item")
    .select("id")
    .eq("external_id", params.thread.threadId)
    .eq("kind", params.kind)
    .eq("status", "PENDING")
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const { error } = await supabase.from("review_item").update(fields).eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("review_item").insert(fields);
  if (error) throw error;
}
