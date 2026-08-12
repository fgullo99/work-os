import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIProvider } from "@/lib/ai";
import type { WhatsAppIngestionRow, WorkItemRow } from "@/lib/supabase/types";
import type { ExistingWorkItemSummary, ReviewProposedPayload } from "@/lib/gmail/types";
import type { ZapiaConversationUnit } from "./zapiaSchema";
import { resolveDatePhrase } from "@/lib/dates/resolveDatePhrase";
import { findBestMatch } from "@/lib/workItems/match";
import { listCompanies, listContacts, listContexts } from "@/lib/workItems/entities";
import { findDuplicateCandidates } from "@/lib/gmail/workItemMatch";
import { safeFieldsToFill, wouldOverwriteExistingValue, TRACKED_FIELDS, type TrackedField } from "@/lib/gmail/decisionEngine";
import { acceptNewWorkItem, applyUpdateToWorkItem } from "@/lib/workItems/reviewItems";
import { findWorkItemByChatId } from "./zapiaMatch";
import { decideZapiaAction, applyZapiaAutomationGate, type ZapiaClassification } from "./zapiaDecision";
import { isAutoCreateEligible, classifyAutoUpdate } from "@/lib/engine/automationGate";
import { getAutomationSettings } from "@/lib/engine/automationSettings";
import { logAiAction } from "@/lib/engine/aiActionLog";

type DB = SupabaseClient;

export interface ZapiaPipelineDeps {
  supabase: DB;
  aiProvider: AIProvider;
  todayISO: string;
}

export type ZapiaConversationOutcome = "review_created" | "auto_created" | "auto_updated" | "ignored" | "duplicate" | "failed";

export interface ZapiaConversationLogEntry {
  idempotencyKey: string;
  chatId: string | null;
  outcome: ZapiaConversationOutcome;
  relevance: string | null;
  classification: string | null;
  confidence: string | null;
  reviewItemId: string | null;
  error: string | null;
}

/** Igual de estable que threadId en Gmail, pero calculado nosotros: si todos los mensajes
 * traen message_id, la clave es el conjunto ordenado de esos ids (una entrega identica
 * siempre produce la misma clave). Si falta alguno, cae a un hash del contenido — sigue
 * siendo estable para reintentos exactos del mismo POST, aunque no detecta un reenvio con
 * mensajes reformateados de forma distinta (limite aceptado para V1). */
export function computeZapiaIdempotencyKey(unit: ZapiaConversationUnit): string {
  const allHaveIds = unit.messages.every((m) => Boolean(m.message_id));
  if (allHaveIds) {
    const ids = unit.messages.map((m) => m.message_id as string).sort();
    return `zapia:msgs:${ids.join(",")}`;
  }
  const chatPart = unit.conversation.chat_id ?? "no-chat";
  const batchPart = unit.batchId ?? "no-batch";
  const contentHash = createHash("sha256")
    .update(unit.messages.map((m) => `${m.sent_at ?? ""}|${m.text}`).join("\n"))
    .digest("hex")
    .slice(0, 32);
  return `zapia:hash:${chatPart}:${batchPart}:${contentHash}`;
}

function toWorkItemSummary(item: WorkItemRow): ExistingWorkItemSummary {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    next_action: item.next_action,
    waiting_for_what: item.waiting_for_what,
    expected_date: item.expected_date,
    due_date: item.due_date,
    committed_date: item.committed_date,
  };
}

function buildRawExcerpt(unit: ZapiaConversationUnit): string {
  const last = unit.messages[unit.messages.length - 1];
  return (last?.text ?? "").slice(0, 500);
}

/** Equivalente WhatsApp de upsertReviewItem(kind:"RECEIVED_CHECK") en applySync.ts. Dedupea
 * por chat_id+kind+status=PENDING igual que Gmail dedupea por thread_id — si Zapia empuja
 * varios batches inbound seguidos sobre el mismo chat en WAITING, actualiza el mismo
 * review_item en vez de acumular uno por batch. */
async function upsertReceivedCheckReviewItem(
  supabase: DB,
  params: {
    workItemId: string;
    chatId: string | null;
    confidence: string;
    rationale: string;
    evidence: string | null;
    unit: ZapiaConversationUnit;
  }
): Promise<string> {
  const fields = {
    kind: "RECEIVED_CHECK" as const,
    work_item_id: params.workItemId,
    duplicate_candidate_ids: null,
    proposed_payload: { note: "Hubo actividad nueva en WhatsApp. Revisa si resuelve lo que estabas esperando." },
    confidence: params.confidence,
    rationale: params.rationale,
    evidence: params.evidence,
    source_type: "WHATSAPP" as const,
    external_id: params.chatId,
    raw_excerpt: buildRawExcerpt(params.unit),
    raw_metadata: { provider: "zapia", batch_id: params.unit.batchId, chat_id: params.chatId },
    occurred_at: params.unit.capturedAt ?? new Date().toISOString(),
  };

  const { data: existing, error: findError } = await supabase
    .from("review_item")
    .select("id")
    .eq("external_id", params.chatId)
    .eq("kind", "RECEIVED_CHECK")
    .eq("status", "PENDING")
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const { error } = await supabase.from("review_item").update(fields).eq("id", existing.id);
    if (error) throw error;
    return (existing as { id: string }).id;
  }

  const { data, error } = await supabase.from("review_item").insert(fields).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/**
 * Procesa UNA conversacion de punta a punta: idempotencia -> matching -> Normalizer ->
 * decision (siempre Review, seccion 7 del spec) -> review_item. Nunca crea ni actualiza un
 * Work Item directamente — Zapia es ingestion, no toma decisiones de negocio.
 */
export async function processZapiaConversation(
  deps: ZapiaPipelineDeps,
  unit: ZapiaConversationUnit
): Promise<ZapiaConversationLogEntry> {
  const idempotencyKey = computeZapiaIdempotencyKey(unit);
  const chatId = unit.conversation.chat_id ?? null;

  const log: ZapiaConversationLogEntry = {
    idempotencyKey,
    chatId,
    outcome: "failed",
    relevance: null,
    classification: null,
    confidence: null,
    reviewItemId: null,
    error: null,
  };

  const { data: existingIngestion, error: findError } = await deps.supabase
    .from("whatsapp_ingestion")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (findError) throw findError;

  const previous = existingIngestion as WhatsAppIngestionRow | null;
  if (previous && previous.status !== "ERROR") {
    log.outcome = "duplicate";
    return log;
  }

  let ingestionId: string;
  if (previous) {
    // Reintento sobre una fila que habia quedado en ERROR (seccion 14: "permitir retry").
    ingestionId = previous.id;
    const { error } = await deps.supabase
      .from("whatsapp_ingestion")
      .update({ status: "RECEIVED", error_message: null })
      .eq("id", ingestionId);
    if (error) throw error;
  } else {
    const { data, error } = await deps.supabase
      .from("whatsapp_ingestion")
      .insert({
        idempotency_key: idempotencyKey,
        batch_id: unit.batchId,
        chat_id: chatId,
        contact_name: unit.conversation.contact_name ?? unit.conversation.chat_name ?? null,
        message_count: unit.messages.length,
        status: "RECEIVED",
      })
      .select("id")
      .single();
    if (error) throw error;
    ingestionId = (data as { id: string }).id;
  }

  try {
    const [companies, contacts, contexts] = await Promise.all([
      listCompanies(deps.supabase),
      listContacts(deps.supabase),
      listContexts(deps.supabase),
    ]);

    const existingWorkItem = chatId ? await findWorkItemByChatId(deps.supabase, chatId) : null;

    const raw = await deps.aiProvider.normalizeWhatsAppConversation({
      unit,
      existingWorkItem: existingWorkItem ? toWorkItemSummary(existingWorkItem) : null,
      currentDateISO: deps.todayISO,
    });

    log.relevance = raw.relevance;
    log.classification = raw.classification;
    log.confidence = raw.confidence;

    const resolved: ZapiaClassification = raw.classification;

    const companyMatch = findBestMatch(companies, raw.suggested_company);
    const contactMatch = findBestMatch(contacts, raw.suggested_contact ?? raw.waiting_for_person);
    const contextMatch = findBestMatch(contexts, raw.suggested_context);

    let duplicateCandidateIds: string[] = [];
    if (!existingWorkItem) {
      const candidates = await findDuplicateCandidates(deps.supabase, {
        title: raw.suggested_context ?? unit.conversation.chat_name ?? unit.conversation.contact_name ?? "WhatsApp",
        contactId: contactMatch?.id ?? null,
        companyId: companyMatch?.id ?? null,
        contextId: contextMatch?.id ?? null,
      });
      duplicateCandidateIds = candidates.map((c) => c.id);
    }

    // Fechas resueltas una sola vez, reusadas tanto por el gate de automatizacion
    // (safeFieldsToFill/classifyAutoUpdate) como por el proposedPayload de Review.
    const resolvedTracked: Record<TrackedField, string | null> = {
      next_action: raw.next_action,
      waiting_for_what: raw.waiting_for_what,
      due_date: resolveDatePhrase(raw.due_date_phrase, deps.todayISO),
      expected_date: resolveDatePhrase(raw.expected_date_phrase, deps.todayISO),
      committed_date: resolveDatePhrase(raw.committed_date_phrase, deps.todayISO),
    };

    const automationSettings = await getAutomationSettings(deps.supabase);
    const lastMessage = unit.messages[unit.messages.length - 1];
    const createEligible = isAutoCreateEligible({
      relevance: raw.relevance,
      confidence: raw.confidence,
      hasClearActor: Boolean(raw.suggested_contact || raw.waiting_for_person),
      hasClearAction: Boolean(raw.next_action || raw.waiting_for_what),
      directionConsistent: lastMessage?.direction !== "unknown",
      hasAmbiguousMatch: duplicateCandidateIds.length > 1,
    });
    // classification se pasa ademas de los TRACKED_FIELDS: safeFieldsToFill lo usa para
    // detectar la transicion ACTION resuelta -> WAITING (ver decisionEngine.ts), mismo
    // criterio que Gmail.
    const changedFields = existingWorkItem
      ? safeFieldsToFill({ ...resolvedTracked, classification: raw.classification }, existingWorkItem)
      : [];
    // Igual que Gmail: si aplicar esto pisaria un campo YA cargado con un valor distinto,
    // nunca es auto-aplicable — va a Review sin importar que changedFields de vacio.
    const hasConflict = existingWorkItem ? wouldOverwriteExistingValue(resolvedTracked, existingWorkItem) : false;
    const updateDecision =
      existingWorkItem && !hasConflict
        ? classifyAutoUpdate({
            relevance: raw.relevance,
            confidence: raw.confidence,
            changedFields,
            matchUnambiguous: true, // findWorkItemByChatId es un match exacto por chat_id, no fuzzy
          })
        : "REVIEW";

    const hasNewInboundMessage = unit.messages.some((m) => m.direction === "inbound");

    const basePlan = decideZapiaAction({
      relevance: raw.relevance,
      classification: resolved,
      existingWorkItem,
      duplicateCandidateIds,
      hasNewInboundMessage,
    });
    const plan = applyZapiaAutomationGate(basePlan, automationSettings.whatsapp_auto_enabled, {
      createEligible,
      updateDecision,
    });

    if (plan.type === "RECEIVED_CHECK") {
      const reviewItemId = await upsertReceivedCheckReviewItem(deps.supabase, {
        workItemId: plan.workItemId,
        chatId,
        confidence: raw.confidence,
        rationale: raw.summary,
        evidence: raw.evidence,
        unit,
      });
      log.reviewItemId = reviewItemId;
      log.outcome = "review_created";
      const { error: receivedUpdateError } = await deps.supabase
        .from("whatsapp_ingestion")
        .update({ status: "PROCESSED", review_item_id: reviewItemId, processed_at: new Date().toISOString() })
        .eq("id", ingestionId);
      if (receivedUpdateError) throw receivedUpdateError;
      return log;
    }

    if (plan.type === "IGNORE") {
      log.outcome = "ignored";
      const { error } = await deps.supabase
        .from("whatsapp_ingestion")
        .update({ status: "IGNORED", processed_at: new Date().toISOString() })
        .eq("id", ingestionId);
      if (error) throw error;
      return log;
    }

    const proposedPayload: ReviewProposedPayload = {
      title: raw.suggested_context || unit.conversation.chat_name || unit.conversation.contact_name || "WhatsApp",
      next_action: resolvedTracked.next_action,
      waiting_for_what: resolvedTracked.waiting_for_what,
      waiting_for_person: raw.waiting_for_person,
      due_date: resolvedTracked.due_date,
      expected_date: resolvedTracked.expected_date,
      committed_date: resolvedTracked.committed_date,
      suggested_company: raw.suggested_company,
      suggested_contact: raw.suggested_contact,
      suggested_context: raw.suggested_context,
      suggested_category: raw.suggested_category,
      blocking: raw.blocking,
      is_delegation: Boolean(raw.responsible),
      classification: raw.classification,
      responsible: raw.responsible,
    };

    const workItemId = plan.type === "REVIEW_UPDATE_WORK_ITEM" || plan.type === "UPDATE_WORK_ITEM_AUTO" ? plan.workItemId : null;
    const duplicateIds = plan.type === "REVIEW_POSSIBLE_DUPLICATE" ? plan.candidateIds : null;

    const { data: reviewItemData, error: reviewError } = await deps.supabase
      .from("review_item")
      .insert({
        kind:
          plan.type === "REVIEW_UPDATE_WORK_ITEM" || plan.type === "UPDATE_WORK_ITEM_AUTO"
            ? "UPDATE_WORK_ITEM"
            : plan.type === "REVIEW_POSSIBLE_DUPLICATE"
              ? "POSSIBLE_DUPLICATE"
              : "NEW_WORK_ITEM",
        work_item_id: workItemId,
        duplicate_candidate_ids: duplicateIds,
        proposed_payload: proposedPayload,
        confidence: raw.confidence,
        rationale: raw.summary,
        evidence: raw.evidence,
        source_type: "WHATSAPP",
        external_id: chatId,
        raw_excerpt: buildRawExcerpt(unit),
        raw_metadata: { provider: "zapia", batch_id: unit.batchId, chat_id: chatId },
        occurred_at: unit.capturedAt ?? new Date().toISOString(),
      })
      .select("id")
      .single();
    if (reviewError) throw reviewError;

    const reviewItemId = (reviewItemData as { id: string }).id;
    log.reviewItemId = reviewItemId;

    if (plan.type === "CREATE_WORK_ITEM") {
      const workItem = await acceptNewWorkItem(deps.supabase, reviewItemId);
      await logAiAction(deps.supabase, {
        sourceType: "WHATSAPP",
        action: "CREATE",
        workItemId: workItem.id,
        confidence: raw.confidence,
        relevance: raw.relevance,
        reasoning: raw.summary,
        changedFields: [],
        beforeValues: {},
        afterValues: { title: workItem.title },
      });
      log.outcome = "auto_created";
    } else if (plan.type === "UPDATE_WORK_ITEM_AUTO") {
      // overrides fuerza a undefined todo lo que NO esta en changedFields — applyUpdateToWorkItem
      // solo toca un campo si es !== undefined, asi que esto restringe el update automatico a
      // exactamente los campos que safeFieldsToFill considero seguros (nunca pisa uno ya cargado).
      const overrides: Partial<ReviewProposedPayload> = { blocking: undefined };
      for (const field of TRACKED_FIELDS) {
        if (!changedFields.includes(field)) overrides[field] = undefined;
      }
      const beforeValues: Record<string, unknown> = {};
      const afterValues: Record<string, unknown> = {};
      for (const field of changedFields) {
        beforeValues[field] = existingWorkItem ? existingWorkItem[field] : null;
        afterValues[field] = resolvedTracked[field];
      }
      await applyUpdateToWorkItem(deps.supabase, reviewItemId, plan.workItemId, overrides);
      await logAiAction(deps.supabase, {
        sourceType: "WHATSAPP",
        action: "UPDATE",
        workItemId: plan.workItemId,
        confidence: raw.confidence,
        relevance: raw.relevance,
        reasoning: raw.summary,
        changedFields,
        beforeValues,
        afterValues,
      });
      log.outcome = "auto_updated";
    } else {
      log.outcome = "review_created";
    }

    const { error: updateError } = await deps.supabase
      .from("whatsapp_ingestion")
      .update({ status: "PROCESSED", review_item_id: reviewItemId, processed_at: new Date().toISOString() })
      .eq("id", ingestionId);
    if (updateError) throw updateError;

    return log;
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    log.outcome = "failed";
    log.error = message;
    // No perdemos los mensajes: la fila whatsapp_ingestion ya tiene chat_id/batch_id/
    // message_count guardados desde antes del try. Queda en ERROR, lista para reintento
    // (el mismo idempotency_key vuelve a entrar en la rama de arriba la proxima vez).
    await deps.supabase
      .from("whatsapp_ingestion")
      .update({ status: "ERROR", error_message: message.slice(0, 500) })
      .eq("id", ingestionId);
    return log;
  }
}
