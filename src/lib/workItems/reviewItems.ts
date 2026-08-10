import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewItemRow, WorkItemRow } from "@/lib/supabase/types";
import type { ReviewProposedPayload } from "@/lib/gmail/types";
import { resolveOrCreateEntities } from "@/lib/gmail/applySync";
import { receiveWaiting } from "./queries";

type DB = SupabaseClient;

export async function listPendingReviewItems(supabase: DB): Promise<ReviewItemRow[]> {
  const { data, error } = await supabase.from("review_item").select("*").eq("status", "PENDING").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ReviewItemRow[];
}

export async function getReviewItem(supabase: DB, id: string): Promise<ReviewItemRow> {
  const { data, error } = await supabase.from("review_item").select("*").eq("id", id).single();
  if (error) throw error;
  return data as ReviewItemRow;
}

export async function ignoreReviewItem(supabase: DB, id: string): Promise<void> {
  const { error } = await supabase
    .from("review_item")
    .update({ status: "IGNORED", resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

async function createSourceLinkFromReviewItem(supabase: DB, workItemId: string, reviewItem: ReviewItemRow): Promise<void> {
  const { error } = await supabase.from("source_link").insert({
    work_item_id: workItemId,
    source_type: reviewItem.source_type,
    external_id: reviewItem.external_id,
    external_url: reviewItem.external_url,
    raw_excerpt: reviewItem.raw_excerpt,
    raw_metadata: reviewItem.raw_metadata,
    direction: reviewItem.direction,
    occurred_at: reviewItem.occurred_at ?? new Date().toISOString(),
  });
  if (error) throw error;
}

/**
 * ACCEPT de un review_item kind=NEW_WORK_ITEM (o "CREATE NEW" sobre un POSSIBLE_DUPLICATE):
 * crea el Work Item + source_link a partir del payload propuesto (el usuario pudo haberlo
 * editado antes de aceptar — overrides). Las Company/Contact/Context se resuelven/crean
 * reciene ACA, nunca antes (mismo helper que usa el camino 100% automatico de Gmail).
 */
export async function acceptNewWorkItem(
  supabase: DB,
  reviewItemId: string,
  overrides?: Partial<ReviewProposedPayload>
): Promise<WorkItemRow> {
  const reviewItem = await getReviewItem(supabase, reviewItemId);
  const payload: ReviewProposedPayload = {
    ...(reviewItem.proposed_payload as unknown as ReviewProposedPayload),
    ...overrides,
  };

  const ids = await resolveOrCreateEntities(supabase, payload);

  const { data: workItem, error } = await supabase
    .from("work_item")
    .insert({
      title: payload.title || "Sin titulo",
      context_id: ids.contextId,
      company_id: ids.companyId,
      contact_id: ids.contactId,
      category: payload.suggested_category ?? null,
      next_action: payload.next_action,
      waiting_for_what: payload.waiting_for_what,
      waiting_for_contact_id: ids.waitingForContactId,
      due_date: payload.due_date,
      expected_date: payload.expected_date,
      committed_date: payload.committed_date,
      blocking: payload.blocking ?? false,
      ai_summary: reviewItem.rationale,
      ai_confidence: reviewItem.confidence,
      last_message_direction: reviewItem.direction,
      status: "OPEN",
    })
    .select()
    .single();
  if (error) throw error;

  await createSourceLinkFromReviewItem(supabase, (workItem as WorkItemRow).id, reviewItem);

  const { error: resolveError } = await supabase
    .from("review_item")
    .update({ status: "ACCEPTED", work_item_id: (workItem as WorkItemRow).id, resolved_at: new Date().toISOString() })
    .eq("id", reviewItemId);
  if (resolveError) throw resolveError;

  return workItem as WorkItemRow;
}

/**
 * APPLY de un review_item kind=UPDATE_WORK_ITEM, o "LINK TO EXISTING" de un
 * POSSIBLE_DUPLICATE (pasando targetWorkItemId explicito). Solo toca los campos presentes
 * en el payload — nunca pisa un campo con `undefined`.
 */
export async function applyUpdateToWorkItem(
  supabase: DB,
  reviewItemId: string,
  targetWorkItemId?: string,
  overrides?: Partial<ReviewProposedPayload>
): Promise<WorkItemRow> {
  const reviewItem = await getReviewItem(supabase, reviewItemId);
  const workItemId = targetWorkItemId ?? reviewItem.work_item_id;
  if (!workItemId) throw new Error("No hay Work Item de destino para aplicar esta sugerencia.");

  const payload: ReviewProposedPayload = {
    ...(reviewItem.proposed_payload as unknown as ReviewProposedPayload),
    ...overrides,
  };

  const patch: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
  if (payload.next_action !== undefined) patch.next_action = payload.next_action;
  if (payload.waiting_for_what !== undefined) patch.waiting_for_what = payload.waiting_for_what;
  if (payload.due_date !== undefined) patch.due_date = payload.due_date;
  if (payload.expected_date !== undefined) patch.expected_date = payload.expected_date;
  if (payload.committed_date !== undefined) patch.committed_date = payload.committed_date;
  if (payload.blocking !== undefined) patch.blocking = payload.blocking;

  const { data, error } = await supabase.from("work_item").update(patch).eq("id", workItemId).select().single();
  if (error) throw error;

  await createSourceLinkFromReviewItem(supabase, workItemId, reviewItem);

  const { error: resolveError } = await supabase
    .from("review_item")
    .update({ status: "APPLIED", work_item_id: workItemId, resolved_at: new Date().toISOString() })
    .eq("id", reviewItemId);
  if (resolveError) throw resolveError;

  return data as WorkItemRow;
}

/** ACCEPT de un review_item kind=RECEIVED_CHECK: reusa receiveWaiting() de Etapa 1 tal cual
 * (nunca cierra un next_action pendiente — esa regla ya vive ahi, no se duplica aca). */
export async function acceptReceivedCheck(supabase: DB, reviewItemId: string): Promise<WorkItemRow> {
  const reviewItem = await getReviewItem(supabase, reviewItemId);
  if (!reviewItem.work_item_id) throw new Error("RECEIVED_CHECK sin work_item_id asociado.");

  const workItem = await receiveWaiting(supabase, reviewItem.work_item_id);

  const { error } = await supabase
    .from("review_item")
    .update({ status: "APPLIED", resolved_at: new Date().toISOString() })
    .eq("id", reviewItemId);
  if (error) throw error;

  return workItem;
}

/** KEEP WAITING sobre un RECEIVED_CHECK: no toca el Work Item, solo descarta la sugerencia. */
export async function keepWaitingFromReviewCheck(supabase: DB, reviewItemId: string): Promise<void> {
  await ignoreReviewItem(supabase, reviewItemId);
}
