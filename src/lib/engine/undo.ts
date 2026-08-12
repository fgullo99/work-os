import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiActionLogRow, WorkItemRow } from "@/lib/supabase/types";

type DB = SupabaseClient;

/**
 * Ventana de tolerancia entre el momento en que se registro la accion automatica
 * (ai_action_log.created_at) y work_item.last_activity_at: la propia accion automatica ya
 * pisa last_activity_at al aplicarse, asi que un delta chico es "fue la misma accion", no
 * actividad humana posterior. Casi todos los caminos de mutacion de work_item (setStatus,
 * updateWorkItem, receiveWaiting, addNote, delegateWorkItem) bumpean last_activity_at, asi
 * que este delta es una señal confiable de "algo paso despues" sin necesitar una columna
 * de auditoria nueva.
 */
const HUMAN_ACTIVITY_TOLERANCE_MS = 5000;

export type UndoResult =
  | { ok: true; kind: "deleted" }
  | { ok: true; kind: "reverted"; revertedFields: string[]; conflictFields: string[] }
  | { ok: false; reason: "not_found" | "already_undone" | "human_activity_since" };

async function markUndone(supabase: DB, logId: string): Promise<void> {
  const { error } = await supabase.from("ai_action_log").update({ undone_at: new Date().toISOString() }).eq("id", logId);
  if (error) throw error;
}

/**
 * Undo de una accion automatica de IA — a nivel de campo, no snapshot completo (ver
 * ai_action_log en schema_automation.sql). CREATE: borra el work_item SOLO si nadie lo toco
 * despues de creado. UPDATE: revierte SOLO los campos que esta accion puntual cambio, y SOLO
 * los que siguen teniendo el valor que la IA escribio (si el usuario ya los edito de nuevo,
 * ese campo queda en conflictFields sin pisarlo).
 */
export async function undoAiAction(supabase: DB, logId: string): Promise<UndoResult> {
  const { data: logRow, error: logError } = await supabase.from("ai_action_log").select("*").eq("id", logId).maybeSingle();
  if (logError) throw logError;
  if (!logRow) return { ok: false, reason: "not_found" };
  const log = logRow as AiActionLogRow;
  if (log.undone_at) return { ok: false, reason: "already_undone" };

  const { data: workItemRow, error: wiError } = await supabase.from("work_item").select("*").eq("id", log.work_item_id).maybeSingle();
  if (wiError) throw wiError;
  if (!workItemRow) {
    await markUndone(supabase, logId);
    return { ok: false, reason: "not_found" };
  }
  const workItem = workItemRow as WorkItemRow;

  const logCreatedMs = new Date(log.created_at).getTime();
  const lastActivityMs = new Date(workItem.last_activity_at).getTime();
  const hasHumanActivitySince = lastActivityMs - logCreatedMs > HUMAN_ACTIVITY_TOLERANCE_MS;

  if (log.action === "CREATE") {
    if (hasHumanActivitySince) {
      await supabase.from("note").insert({
        work_item_id: workItem.id,
        body: "Undo bloqueado: hubo actividad despues de que la IA creo este item automaticamente. Revisalo manualmente.",
      });
      return { ok: false, reason: "human_activity_since" };
    }
    const { error } = await supabase.from("work_item").delete().eq("id", workItem.id);
    if (error) throw error;
    await markUndone(supabase, logId);
    return { ok: true, kind: "deleted" };
  }

  const revertedFields: string[] = [];
  const conflictFields: string[] = [];
  const patch: Record<string, unknown> = {};
  const workItemFields = workItem as unknown as Record<string, unknown>;
  for (const field of log.changed_fields) {
    const currentValue = workItemFields[field];
    const afterValue = log.after_values[field];
    if (JSON.stringify(currentValue) === JSON.stringify(afterValue)) {
      patch[field] = log.before_values[field] ?? null;
      revertedFields.push(field);
    } else {
      conflictFields.push(field);
    }
  }

  if (revertedFields.length > 0) {
    const { error } = await supabase.from("work_item").update(patch).eq("id", workItem.id);
    if (error) throw error;
  }
  await markUndone(supabase, logId);
  return { ok: true, kind: "reverted", revertedFields, conflictFields };
}
