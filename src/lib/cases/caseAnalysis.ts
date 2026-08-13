import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiConfidence, CaseRow, CaseSourceLinkRow } from "@/lib/supabase/types";
import type { AIProvider, AiUsage } from "@/lib/ai";
import type { CaseStateResult } from "@/lib/ai/caseSchema";
import type { NormalizedMessage, NormalizedThread } from "@/lib/gmail/types";
import { applyRuleFilter } from "@/lib/gmail/ruleFilter";
import { resolveDatePhrase } from "@/lib/dates/resolveDatePhrase";
import { extractReferencesFromThread } from "./referenceExtraction";
import { matchCaseForThread, type CaseMatchTier } from "./caseMatch";
import { buildEventLabel } from "./eventLabel";
import type { CaseHistoryEntry, ExistingCaseSummary } from "./caseHistoryText";
import type { InternalTeamMember } from "./teamMembers";
import { listContacts } from "./entities";
import { createCase, findCaseByThreadId, listOpenCases, getCaseSources, getExistingCaseSourceMessageIds, addCaseSourceLink, updateCaseState } from "./queries";

type DB = SupabaseClient;

export interface CaseSyncLogEntry {
  threadId: string;
  subject: string;
  ruleFilterSkipped: boolean;
  ruleFilterReason: string | null;
  matchTier: CaseMatchTier | null;
  llmCalled: boolean;
  currentState: string | null;
  currentOwner: string | null;
  felipeActionRequired: boolean | null;
  confidence: string | null;
  risk: string | null;
  /** AUTO_CREATE_CASE | AUTO_MERGE | CASE_MERGE_REVIEW | CASE_STATE_REVIEW |
   * "IGNORE (rule filter)" | ERROR — ver classifyCaseThreadOutcome en caseCatchup.ts. */
  action: string;
  resultingCaseId: string | null;
  rationale: string | null;
}

export interface CaseAnalysisDeps {
  supabase: DB;
  aiProvider: AIProvider;
  todayISO: string;
  /** Mismo kill switch que Gmail (google_connection.safe_mode) — con true, todo pasa por
   * CASE_STATE_REVIEW, nunca auto-aplica. */
  safeMode: boolean;
  userAddresses: string[];
  internalTeamMembers: InternalTeamMember[];
  onAiUsage?: (usage: AiUsage) => void;
}

/**
 * Gate puro (mirror de applyAutomationGate en applySync.ts): decide si el resultado del AI
 * Case Analyzer se auto-aplica o requiere CASE_STATE_REVIEW. Acotado a las 4 categorias
 * pedidas explicitamente — CASE_STATE_REVIEW nunca deberia significar otra cosa:
 *   1) owner dudoso — current_owner=UNKNOWN.
 *   2) posible cierre — CLOSED sin confidence HIGH + evidencia inequivoca (nunca "cerrar por
 *      las dudas").
 *   3) estado ambiguo — el propio modelo se marca REVIEW, o confidence=LOW en un estado
 *      realmente accionable.
 *   (merge ambiguo es CASE_MERGE_REVIEW, un gate aparte en matchCaseForThread — no pasa por
 *   esta funcion.)
 *
 * A proposito NO manda a Review un NO_ACTION con confidence LOW: es el patron INFO/FYI ya
 * resuelto (nada pendiente de nadie) — forzar confirmacion manual por una duda menor ahi es
 * puro ruido, no una ambiguedad real que valga la atencion de Felipe.
 */
export function applyCaseStateGate(result: CaseStateResult, safeMode: boolean): "PASS" | "REVIEW" {
  if (safeMode) return "REVIEW";
  if (result.current_owner === "UNKNOWN") return "REVIEW";
  if (result.current_state === "CLOSED") {
    return result.confidence === "HIGH" && result.closure_evidence_unambiguous ? "PASS" : "REVIEW";
  }
  if (result.current_state === "REVIEW") return "REVIEW";
  if (result.confidence === "LOW" && result.current_state !== "NO_ACTION") return "REVIEW";
  return "PASS";
}

function emptyLog(thread: NormalizedThread): CaseSyncLogEntry {
  return {
    threadId: thread.threadId,
    subject: thread.subject,
    ruleFilterSkipped: false,
    ruleFilterReason: null,
    matchTier: null,
    llmCalled: false,
    currentState: null,
    currentOwner: null,
    felipeActionRequired: null,
    confidence: null,
    risk: null,
    action: "",
    resultingCaseId: null,
    rationale: null,
  };
}

/** El primer participante externo (no interno de TMC) que aparece en el thread — prioriza el
 * remitente del primer mensaje INBOUND (tipicamente quien inicia el contacto), si no hay
 * ninguno cae a cualquier direccion externa en To/Cc. Sin IA — solo texto. */
function extractExternalEmail(thread: NormalizedThread, internalEmails: Set<string>): string | null {
  for (const m of thread.messages) {
    if (m.direction === "INBOUND" && !internalEmails.has(m.from.toLowerCase())) return m.from.toLowerCase();
  }
  for (const m of thread.messages) {
    const candidate = [...m.to, ...m.cc].map((e) => e.toLowerCase()).find((e) => !internalEmails.has(e));
    if (candidate) return candidate;
  }
  return null;
}

/** Resolucion de company/contact BARATA (sin IA, sin fuzzy matching de texto): busca al
 * participante externo del thread entre los contacts YA cargados. Si no esta, queda null —
 * no se crea un contact/company a ciegas solo para matchear (eso se deja para cuando el AI
 * Case Analyzer o Felipe confirmen el asunto). */
async function resolveExternalParty(
  supabase: DB,
  thread: NormalizedThread,
  userAddresses: string[],
  internalTeamMembers: InternalTeamMember[]
): Promise<{ contactId: string | null; companyId: string | null }> {
  const internalEmails = new Set([
    ...userAddresses.map((a) => a.toLowerCase()),
    ...internalTeamMembers.map((m) => m.email.toLowerCase()),
  ]);
  const email = extractExternalEmail(thread, internalEmails);
  if (!email) return { contactId: null, companyId: null };
  const contacts = await listContacts(supabase);
  const match = contacts.find((c) => c.email?.toLowerCase() === email);
  return match ? { contactId: match.id, companyId: match.company_id } : { contactId: null, companyId: null };
}

/** Agrega a case_source_link los mensajes del thread que todavia no estaban vinculados a
 * este Case (un row por MENSAJE, no por thread — ver nota en schema_case_phase2.sql). Nunca
 * duplica: reprocesar el mismo thread solo suma los mensajes nuevos. */
async function attachThreadMessages(supabase: DB, caseId: string, thread: NormalizedThread): Promise<void> {
  const existingIds = await getExistingCaseSourceMessageIds(supabase, caseId, thread.threadId);
  for (const message of thread.messages) {
    if (existingIds.has(message.id)) continue;
    await addCaseSourceLink(supabase, {
      caseId,
      sourceType: "GMAIL",
      externalId: thread.threadId,
      externalMessageId: message.id,
      externalUrl: thread.webUrl,
      rawExcerpt: (message.bodyText || message.snippet || "").slice(0, 500),
      rawMetadata: { subject: message.subject, from: message.fromName || message.from, to: message.to, cc: message.cc },
      direction: message.direction,
      eventLabel: buildEventLabel({ sourceType: "GMAIL", direction: message.direction, from: message.fromName || message.from }),
      occurredAt: message.date,
    });
  }
}

function sourceLinkToHistoryEntry(link: CaseSourceLinkRow): CaseHistoryEntry {
  const meta = (link.raw_metadata ?? {}) as { from?: string; to?: string[]; cc?: string[] };
  return {
    occurredAt: link.occurred_at,
    sourceType: link.source_type,
    direction: link.direction,
    from: meta.from ?? "?",
    to: meta.to,
    cc: meta.cc,
    text: link.raw_excerpt ?? "",
  };
}

function toExistingCaseSummary(c: CaseRow): ExistingCaseSummary {
  return { currentState: c.current_state, currentOwner: c.current_owner, nextAction: c.next_action, waitingFor: c.waiting_for };
}

/** Mismo patron que upsertReviewItem en applySync.ts, pero apuntando a case_id en vez de
 * work_item_id, y soportando los 2 kinds nuevos. Dedupe identico: si ya hay un review_item
 * PENDING del mismo kind para el mismo thread, lo actualiza en vez de duplicarlo. */
async function upsertCaseReview(
  supabase: DB,
  params: {
    kind: "CASE_MERGE_REVIEW" | "CASE_STATE_REVIEW";
    caseId: string | null;
    duplicateCandidateIds?: string[];
    proposedPayload: Record<string, unknown>;
    confidence: AiConfidence;
    rationale: string | null;
    thread: NormalizedThread;
    latestMessage: NormalizedMessage | undefined;
  }
): Promise<void> {
  const fields = {
    kind: params.kind,
    work_item_id: null,
    case_id: params.caseId,
    duplicate_candidate_ids: params.duplicateCandidateIds ?? null,
    proposed_payload: params.proposedPayload,
    confidence: params.confidence,
    rationale: params.rationale,
    evidence: null,
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

/**
 * Orquestador principal del pivot a Case (item 28 del pedido): GMAIL INGESTION → THREAD
 * NORMALIZATION → REFERENCE EXTRACTION → CASE MATCHING → CASE TIMELINE BUILD → AI CURRENT
 * STATE ANALYSIS → CASE UPDATE. Mirror de processThread() en applySync.ts, pero Case-first —
 * nunca crea un Work Item (item 29).
 */
export async function processThreadForCase(deps: CaseAnalysisDeps, thread: NormalizedThread): Promise<CaseSyncLogEntry> {
  const log = emptyLog(thread);

  const ruleResult = applyRuleFilter(thread);
  if (ruleResult.skip) {
    log.ruleFilterSkipped = true;
    log.ruleFilterReason = ruleResult.reason;
    log.action = "IGNORE (rule filter)";
    return log;
  }

  const latestMessage = thread.messages[thread.messages.length - 1];

  // Idempotencia: si este thread YA esta vinculado a un Case, no se vuelve a matchear —
  // va directo a reanalizar ese mismo Case con los mensajes nuevos.
  const existingCase = await findCaseByThreadId(deps.supabase, thread.threadId);

  let targetCase: CaseRow;
  if (existingCase) {
    targetCase = existingCase;
    await attachThreadMessages(deps.supabase, targetCase.id, thread);
    log.action = "AUTO_MERGE";
  } else {
    const references = extractReferencesFromThread(thread);
    const primaryReference = references[0] ?? null;
    const { contactId, companyId } = await resolveExternalParty(deps.supabase, thread, deps.userAddresses, deps.internalTeamMembers);

    const openCases = await listOpenCases(deps.supabase, companyId);
    const matchResult = matchCaseForThread(
      {
        extractedReferences: references,
        companyId,
        threadSubjectOrTitle: thread.subject,
        occurredAt: latestMessage?.date ?? new Date().toISOString(),
      },
      openCases
    );
    log.matchTier = matchResult.tier;

    if (matchResult.tier === "EXACT" || matchResult.tier === "STRONG") {
      targetCase = matchResult.candidates[0]!;
      await attachThreadMessages(deps.supabase, targetCase.id, thread);
      log.action = "AUTO_MERGE";
    } else if (matchResult.tier === "PROBABLE" || matchResult.tier === "AMBIGUOUS") {
      // Ambiguo: nunca se auto-mergea (item 17) — y nunca se gasta una llamada de IA en un
      // match que no se va a aplicar solo.
      await upsertCaseReview(deps.supabase, {
        kind: "CASE_MERGE_REVIEW",
        caseId: null,
        duplicateCandidateIds: matchResult.candidates.map((c) => c.id),
        proposedPayload: {
          threadSubject: thread.subject,
          suggestedTitle: primaryReference ? `${primaryReference.type} ${primaryReference.value}` : thread.subject,
          extractedReference: primaryReference,
          candidateTitles: matchResult.candidates.map((c) => c.title),
          companyId,
          contactId,
          reason: matchResult.reason,
        },
        confidence: matchResult.tier === "PROBABLE" ? "MEDIUM" : "LOW",
        rationale: matchResult.reason,
        thread,
        latestMessage,
      });
      log.action = "CASE_MERGE_REVIEW";
      return log;
    } else {
      const title = primaryReference ? `${primaryReference.type} ${primaryReference.value}` : thread.subject;
      targetCase = await createCase(deps.supabase, {
        title,
        companyId,
        contactId,
        contextId: null,
        referenceType: primaryReference?.type ?? null,
        referenceValue: primaryReference?.value ?? null,
      });
      await attachThreadMessages(deps.supabase, targetCase.id, thread);
      log.action = "AUTO_CREATE_CASE";
    }
  }

  log.resultingCaseId = targetCase.id;

  // Reanaliza SIEMPRE con la historia COMPLETA del Case (item 8) — nunca solo el thread nuevo.
  const sources = await getCaseSources(deps.supabase, targetCase.id);
  const entries = sources.map(sourceLinkToHistoryEntry);

  log.llmCalled = true;
  const usageThisCall = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const result = await deps.aiProvider.analyzeCaseState(
    {
      caseTitle: targetCase.title,
      referenceLabel: targetCase.reference_value ? `${targetCase.reference_type ?? "?"} ${targetCase.reference_value}` : null,
      entries,
      internalTeamMembers: deps.internalTeamMembers,
      existing: existingCase ? toExistingCaseSummary(existingCase) : null,
      currentDateISO: deps.todayISO,
    },
    (usage) => {
      usageThisCall.calls += 1;
      usageThisCall.inputTokens += usage.inputTokens;
      usageThisCall.outputTokens += usage.outputTokens;
      deps.onAiUsage?.(usage);
    }
  );

  log.currentState = result.current_state;
  log.currentOwner = result.current_owner;
  log.felipeActionRequired = result.felipe_action_required;
  log.confidence = result.confidence;
  log.risk = result.risk;
  log.rationale = result.summary;

  const gate = applyCaseStateGate(result, deps.safeMode);
  if (gate === "REVIEW") {
    await upsertCaseReview(deps.supabase, {
      kind: "CASE_STATE_REVIEW",
      caseId: targetCase.id,
      proposedPayload: {
        caseId: targetCase.id,
        caseTitle: targetCase.title,
        proposedState: {
          current_state: result.current_state,
          current_owner: result.current_owner,
          felipe_action_required: result.felipe_action_required,
          next_action: result.next_action,
          waiting_for: result.waiting_for,
          responsible: result.responsible,
          last_meaningful_event: result.last_meaningful_event,
          risk: result.risk,
          closure_evidence_unambiguous: result.closure_evidence_unambiguous,
        },
        summary: result.summary,
      },
      confidence: result.confidence,
      rationale: result.summary,
      thread,
      latestMessage,
    });
    // Saca al Case de las columnas operativas del Kanban hasta que se confirme — nunca deja
    // un estado viejo/no confirmado mostrandose como si fuera valido. Igual se registra el
    // costo de la llamada (se gasto igual, aunque el resultado no se auto-aplique).
    const { error } = await deps.supabase
      .from("case")
      .update({
        current_state: "REVIEW",
        last_activity_at: new Date().toISOString(),
        ai_calls_count: targetCase.ai_calls_count + usageThisCall.calls,
        ai_input_tokens: targetCase.ai_input_tokens + usageThisCall.inputTokens,
        ai_output_tokens: targetCase.ai_output_tokens + usageThisCall.outputTokens,
      })
      .eq("id", targetCase.id);
    if (error) throw error;
    log.action = "CASE_STATE_REVIEW";
    return log;
  }

  await updateCaseState(deps.supabase, targetCase.id, targetCase, {
    currentState: result.current_state,
    currentOwner: result.current_owner,
    felipeActionRequired: result.felipe_action_required,
    nextAction: result.next_action,
    waitingFor: result.waiting_for,
    responsible: result.responsible,
    dueDate: resolveDatePhrase(result.due_date_phrase, deps.todayISO),
    expectedDate: resolveDatePhrase(result.expected_date_phrase, deps.todayISO),
    risk: result.risk,
    confidence: result.confidence,
    aiSummary: result.summary,
    lastMeaningfulEvent: result.last_meaningful_event,
    referenceType: result.reference_type ?? targetCase.reference_type,
    referenceValue: result.reference_value ?? targetCase.reference_value,
    addAiCalls: usageThisCall.calls,
    addAiInputTokens: usageThisCall.inputTokens,
    addAiOutputTokens: usageThisCall.outputTokens,
  });

  return log;
}
