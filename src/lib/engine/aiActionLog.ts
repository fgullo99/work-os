import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

/**
 * Registro de auditoria de cada accion automatica de la IA (AUTO_CREATE/AUTO_UPDATE, Gmail
 * o WhatsApp) — alimenta el feed de "AI Activity" en RecentActivity y el endpoint de Undo
 * (src/app/api/ai-activity/[id]/undo/route.ts). Deliberadamente guarda antes/despues A NIVEL
 * DE CAMPO (changed_fields/before_values/after_values), no un snapshot completo del
 * work_item — el undo solo puede revertir exactamente lo que esta accion toco, y solo si
 * nadie mas lo toco despues (ver undo.ts).
 */
export interface LogAiActionParams {
  sourceType: "GMAIL" | "WHATSAPP";
  action: "CREATE" | "UPDATE";
  workItemId: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  relevance: "WORK" | "PERSONAL" | "UNCERTAIN";
  reasoning: string | null;
  changedFields: string[];
  beforeValues: Record<string, unknown>;
  afterValues: Record<string, unknown>;
}

export async function logAiAction(supabase: DB, params: LogAiActionParams): Promise<void> {
  const { error } = await supabase.from("ai_action_log").insert({
    source_type: params.sourceType,
    action: params.action,
    work_item_id: params.workItemId,
    confidence: params.confidence,
    relevance: params.relevance,
    reasoning: params.reasoning,
    changed_fields: params.changedFields,
    before_values: params.beforeValues,
    after_values: params.afterValues,
  });
  if (error) throw error;
}
