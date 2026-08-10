import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkItemRow } from "@/lib/supabase/types";

type DB = SupabaseClient;

/**
 * Regla #1 de matching para WhatsApp, igual de fuerte que "mismo Gmail thread" en Gmail:
 * mismo chat_id de WhatsApp ya visto antes = mismo Work Item. chat_id es a WhatsApp lo que
 * threadId es a Gmail — un identificador estable de "esta conversacion puntual".
 */
export async function findWorkItemByChatId(supabase: DB, chatId: string): Promise<WorkItemRow | null> {
  const { data, error } = await supabase
    .from("source_link")
    .select("work_item_id, work_item:work_item_id(*)")
    .eq("source_type", "WHATSAPP")
    .eq("external_id", chatId)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const workItem = (data as unknown as { work_item: WorkItemRow | null }).work_item;
  return workItem ?? null;
}
