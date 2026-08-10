import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkItemRow } from "@/lib/supabase/types";

type DB = SupabaseClient;

/**
 * Regla #1 de matching (la mas fuerte): mismo Gmail thread = mismo Work Item.
 * "Existing Work Item First" — se busca esto ANTES de considerar crear uno nuevo.
 */
export async function findWorkItemByThreadId(supabase: DB, threadId: string): Promise<WorkItemRow | null> {
  const { data, error } = await supabase
    .from("source_link")
    .select("work_item_id, work_item:work_item_id(*)")
    .eq("source_type", "GMAIL")
    .eq("external_id", threadId)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const workItem = (data as unknown as { work_item: WorkItemRow | null }).work_item;
  return workItem ?? null;
}

export interface DedupCandidateParams {
  title: string;
  contactId: string | null;
  companyId: string | null;
  contextId: string | null;
  excludeWorkItemId?: string;
}

// Unicode combining diacritics (ver nota identica en src/lib/dates/resolveDatePhrase.ts):
// se filtra por code point en vez de usar una regex con tildes literales en el codigo fuente.
function stripAccents(value: string): string {
  return Array.from(value.normalize("NFD"))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x0300 || code > 0x036f;
    })
    .join("");
}

function titleWords(title: string): Set<string> {
  const normalized = stripAccents(title).toLowerCase();
  return new Set(normalized.split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
}

/** Similaridad simple por superposicion de palabras (sin embeddings, a proposito — ver spec).
 * Exportada para testearla directamente sin necesitar un cliente de Supabase. */
export function titleSimilarity(a: string, b: string): number {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap += 1;
  return overlap / Math.min(wa.size, wb.size);
}

/**
 * Regla #2 (heuristica, secundaria): candidatos a posible duplicado cuando NO hubo match
 * directo por thread. Busca por mismo contacto/empresa/context entre Work Items abiertos,
 * y se queda solo con los que ademas tienen titulo razonablemente parecido — para no
 * proponer "posible duplicado" solo porque comparten cliente.
 */
export async function findDuplicateCandidates(supabase: DB, params: DedupCandidateParams): Promise<WorkItemRow[]> {
  if (!params.contactId && !params.companyId && !params.contextId) return [];

  const orParts: string[] = [];
  if (params.contactId) orParts.push(`contact_id.eq.${params.contactId}`);
  if (params.companyId) orParts.push(`company_id.eq.${params.companyId}`);
  if (params.contextId) orParts.push(`context_id.eq.${params.contextId}`);

  const { data, error } = await supabase
    .from("work_item")
    .select("*")
    .in("status", ["OPEN", "DELEGATED"])
    .or(orParts.join(","));

  if (error) throw error;

  const candidates = (data ?? []) as WorkItemRow[];
  return candidates
    .filter((c) => c.id !== params.excludeWorkItemId)
    .filter((c) => titleSimilarity(params.title, c.title) >= 0.5);
}
