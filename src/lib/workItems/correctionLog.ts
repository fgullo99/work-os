import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { WorkItemRow } from "@/lib/supabase/types";
import { CORRECTABLE_FIELDS, type CorrectableField } from "./types";

function normalizeForCompare(item: WorkItemRow, field: CorrectableField): string | null {
  const value = item[field as keyof WorkItemRow];
  if (value === null || value === undefined) return null;
  return String(value);
}

/** Compara los valores sugeridos por IA contra los valores finales y registra las diferencias. */
export async function logCorrections(
  supabase: SupabaseServerClient,
  workItemId: string,
  aiOriginal: Partial<Record<CorrectableField, string | null>>,
  finalItem: WorkItemRow
) {
  const rows = CORRECTABLE_FIELDS.filter((field) => field in aiOriginal)
    .map((field) => {
      const oldValue = aiOriginal[field] ?? null;
      const newValue = normalizeForCompare(finalItem, field);
      return { field, oldValue, newValue };
    })
    .filter(({ oldValue, newValue }) => oldValue !== newValue)
    .map(({ field, oldValue, newValue }) => ({
      work_item_id: workItemId,
      field,
      old_value: oldValue,
      new_value: newValue,
    }));

  if (rows.length === 0) return;

  const { error } = await supabase.from("correction_log").insert(rows);
  if (error) throw error;
}

/**
 * Registra correcciones aplicadas via edicion posterior (PATCH), comparando el
 * estado previo del Work Item contra el nuevo, solo si el item tenia ai_confidence
 * (es decir, sus valores originales vinieron de una sugerencia de IA).
 */
export async function logCorrectionsOnUpdate(
  supabase: SupabaseServerClient,
  workItemId: string,
  before: WorkItemRow,
  after: WorkItemRow,
  changedFields: string[]
) {
  if (!before.ai_confidence) return;

  const rows = CORRECTABLE_FIELDS.filter((field) => changedFields.includes(field))
    .map((field) => ({
      field,
      oldValue: normalizeForCompare(before, field),
      newValue: normalizeForCompare(after, field),
    }))
    .filter(({ oldValue, newValue }) => oldValue !== newValue)
    .map(({ field, oldValue, newValue }) => ({
      work_item_id: workItemId,
      field,
      old_value: oldValue,
      new_value: newValue,
    }));

  if (rows.length === 0) return;

  const { error } = await supabase.from("correction_log").insert(rows);
  if (error) throw error;
}
