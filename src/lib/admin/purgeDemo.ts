import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

export interface PurgeDemoResult {
  reviewItems: number;
  sourceLinks: number;
  notes: number;
  workItems: number;
  contacts: number;
  contexts: number;
  companies: number;
}

/**
 * Borra UNICAMENTE filas marcadas is_demo=true (las que crea scripts/seed.ts). Nunca toca
 * una fila real: no hay forma de que datos capturados por el usuario, Gmail o WhatsApp
 * terminen con is_demo=true, porque ningun camino de escritura real setea ese campo (queda
 * en su default `false`).
 *
 * Orden de borrado respeta FKs: primero lo que cuelga de work_item (review_item,
 * source_link, note del propio work item demo), despues los work_item, y recien al final
 * company/contact/context (que las tablas demo dejan de referenciar en el paso anterior).
 */
export async function purgeDemoData(supabase: DB): Promise<PurgeDemoResult> {
  const { data: demoWorkItems, error: demoWorkItemsError } = await supabase
    .from("work_item")
    .select("id")
    .eq("is_demo", true);
  if (demoWorkItemsError) throw demoWorkItemsError;
  const demoWorkItemIds = (demoWorkItems ?? []).map((row) => (row as { id: string }).id);

  const { count: reviewItems, error: reviewError } = await supabase
    .from("review_item")
    .delete({ count: "exact" })
    .eq("is_demo", true);
  if (reviewError) throw reviewError;

  const { count: sourceLinks, error: sourceLinkError } = await supabase
    .from("source_link")
    .delete({ count: "exact" })
    .eq("is_demo", true);
  if (sourceLinkError) throw sourceLinkError;

  let notes = 0;
  if (demoWorkItemIds.length > 0) {
    const { count, error: noteError } = await supabase
      .from("note")
      .delete({ count: "exact" })
      .in("work_item_id", demoWorkItemIds);
    if (noteError) throw noteError;
    notes = count ?? 0;
  }

  const { count: workItems, error: workItemError } = await supabase
    .from("work_item")
    .delete({ count: "exact" })
    .eq("is_demo", true);
  if (workItemError) throw workItemError;

  const { count: contacts, error: contactError } = await supabase
    .from("contact")
    .delete({ count: "exact" })
    .eq("is_demo", true);
  if (contactError) throw contactError;

  const { count: contexts, error: contextError } = await supabase
    .from("context")
    .delete({ count: "exact" })
    .eq("is_demo", true);
  if (contextError) throw contextError;

  const { count: companies, error: companyError } = await supabase
    .from("company")
    .delete({ count: "exact" })
    .eq("is_demo", true);
  if (companyError) throw companyError;

  return {
    reviewItems: reviewItems ?? 0,
    sourceLinks: sourceLinks ?? 0,
    notes,
    workItems: workItems ?? 0,
    contacts: contacts ?? 0,
    contexts: contexts ?? 0,
    companies: companies ?? 0,
  };
}
