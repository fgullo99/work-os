import type { SupabaseClient } from "@supabase/supabase-js";
import type { AutomationSettingsRow } from "@/lib/supabase/types";

type DB = SupabaseClient;

/**
 * Fila unica de configuracion (automation_settings). Solo cubre WhatsApp — Gmail usa
 * google_connection.safe_mode como unica fuente de verdad (ver Settings → AI Automation).
 * Si por algun motivo la fila no existe todavia (antes de correr schema_automation.sql en
 * un ambiente nuevo), se devuelve el default seguro (auto OFF) en vez de fallar.
 */
export async function getAutomationSettings(supabase: DB): Promise<AutomationSettingsRow> {
  const { data, error } = await supabase.from("automation_settings").select("*").limit(1).maybeSingle();
  if (error) throw error;
  if (data) return data as AutomationSettingsRow;
  return { id: "default", whatsapp_auto_enabled: false, min_confidence: "HIGH", updated_at: new Date().toISOString() };
}

export async function setWhatsappAutoEnabled(supabase: DB, enabled: boolean): Promise<void> {
  const { data: existing, error: findError } = await supabase.from("automation_settings").select("id").limit(1).maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const { error } = await supabase
      .from("automation_settings")
      .update({ whatsapp_auto_enabled: enabled, updated_at: new Date().toISOString() })
      .eq("id", (existing as { id: string }).id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("automation_settings").insert({ whatsapp_auto_enabled: enabled });
  if (error) throw error;
}
