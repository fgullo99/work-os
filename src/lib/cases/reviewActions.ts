import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaseRow } from "@/lib/supabase/types";
import { getReviewItem, ignoreReviewItem } from "@/lib/workItems/reviewItems";
import { createCase, getCase, addCaseSourceLink, updateCaseState } from "./queries";

type DB = SupabaseClient;

interface CaseMergeReviewPayload {
  threadSubject: string;
  suggestedTitle: string;
  extractedReference: { type: string; value: string } | null;
  candidateTitles: string[];
  companyId: string | null;
  contactId: string | null;
  reason: string;
}

/**
 * ACCEPT de un review_item kind=CASE_MERGE_REVIEW: si Felipe elige uno de los candidatos
 * (targetCaseId), mergea el thread ahi; si no (o "Crear Case nuevo"), crea un Case con lo
 * propuesto. En los dos casos agrega el mensaje mas reciente como case_source_link — mismo
 * alcance que acceptNewWorkItem en reviewItems.ts: solo el ultimo mensaje capturado en el
 * momento del review, no el historial completo del thread. Reanalizar con la IA (para que el
 * Case refleje el estado actual con esta info nueva) queda para el proximo pase del catch-up,
 * no bloquea esta accion manual.
 */
export async function acceptCaseMergeReview(supabase: DB, reviewItemId: string, targetCaseId?: string | null): Promise<CaseRow> {
  const reviewItem = await getReviewItem(supabase, reviewItemId);
  const payload = reviewItem.proposed_payload as unknown as CaseMergeReviewPayload;

  let targetCase: CaseRow;
  if (targetCaseId) {
    const existing = await getCase(supabase, targetCaseId);
    if (!existing) throw new Error(`Case ${targetCaseId} no encontrado.`);
    targetCase = existing;
  } else {
    targetCase = await createCase(supabase, {
      title: payload.suggestedTitle || payload.threadSubject,
      companyId: payload.companyId,
      contactId: payload.contactId,
      contextId: null,
      referenceType: payload.extractedReference?.type ?? null,
      referenceValue: payload.extractedReference?.value ?? null,
    });
  }

  if (reviewItem.external_id) {
    await addCaseSourceLink(supabase, {
      caseId: targetCase.id,
      sourceType: reviewItem.source_type,
      externalId: reviewItem.external_id,
      externalMessageId: reviewItem.external_message_id,
      externalUrl: reviewItem.external_url,
      rawExcerpt: reviewItem.raw_excerpt,
      rawMetadata: reviewItem.raw_metadata,
      direction: reviewItem.direction,
      eventLabel: null,
      occurredAt: reviewItem.occurred_at ?? new Date().toISOString(),
    });
  }

  const { error } = await supabase
    .from("review_item")
    .update({ status: "APPLIED", case_id: targetCase.id, resolved_at: new Date().toISOString() })
    .eq("id", reviewItemId);
  if (error) throw error;

  return targetCase;
}

/** IGNORE de CASE_MERGE_REVIEW: no crea ni mergea nada, solo descarta la sugerencia. */
export async function ignoreCaseMergeReview(supabase: DB, reviewItemId: string): Promise<void> {
  await ignoreReviewItem(supabase, reviewItemId);
}

interface CaseStateReviewPayload {
  caseId: string;
  caseTitle: string;
  proposedState: {
    current_state: string;
    current_owner: string;
    felipe_action_required: boolean;
    next_action: string | null;
    waiting_for: string | null;
    responsible: string | null;
    last_meaningful_event: string;
    risk: string;
    closure_evidence_unambiguous: boolean;
  };
  summary: string;
}

/** ACCEPT de CASE_STATE_REVIEW: aplica el estado que la IA propuso (y que no pudo
 * auto-aplicarse — ver applyCaseStateGate) tal cual lo confirma Felipe, sin volver a llamar
 * a la IA. */
export async function acceptCaseStateReview(supabase: DB, reviewItemId: string): Promise<CaseRow> {
  const reviewItem = await getReviewItem(supabase, reviewItemId);
  const payload = reviewItem.proposed_payload as unknown as CaseStateReviewPayload;

  const current = await getCase(supabase, payload.caseId);
  if (!current) throw new Error(`Case ${payload.caseId} no encontrado.`);

  await updateCaseState(supabase, current.id, current, {
    currentState: payload.proposedState.current_state,
    currentOwner: payload.proposedState.current_owner,
    felipeActionRequired: payload.proposedState.felipe_action_required,
    nextAction: payload.proposedState.next_action,
    waitingFor: payload.proposedState.waiting_for,
    responsible: payload.proposedState.responsible,
    dueDate: current.due_date,
    expectedDate: current.expected_date,
    risk: payload.proposedState.risk,
    confidence: current.confidence ?? "MEDIUM",
    aiSummary: payload.summary,
    lastMeaningfulEvent: payload.proposedState.last_meaningful_event,
    addAiCalls: 0,
    addAiInputTokens: 0,
    addAiOutputTokens: 0,
  });

  const { error } = await supabase
    .from("review_item")
    .update({ status: "APPLIED", resolved_at: new Date().toISOString() })
    .eq("id", reviewItemId);
  if (error) throw error;

  const updated = await getCase(supabase, current.id);
  if (!updated) throw new Error(`Case ${current.id} desaparecio despues de actualizarlo.`);
  return updated;
}

/** IGNORE de CASE_STATE_REVIEW: el Case queda en REVIEW (nunca se inventa volver a un estado
 * viejo) hasta que un evento nuevo lo vuelva a analizar. */
export async function ignoreCaseStateReview(supabase: DB, reviewItemId: string): Promise<void> {
  await ignoreReviewItem(supabase, reviewItemId);
}
