import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaseRow } from "@/lib/supabase/types";

type DB = SupabaseClient;

/**
 * searchCases() — mirror de searchWorkItems() (ver workItems/queries.ts) pero sobre Case:
 * ademas de title/reference_value/next_action/waiting_for, tambien busca en el raw_excerpt de
 * los case_source_link (item: "40991" debe encontrar el Case por reference_value ilike, y
 * tambien por texto suelto mencionado en algun mensaje del timeline).
 */
export async function searchCases(supabase: DB, query: string): Promise<CaseRow[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const q = `%${trimmed}%`;

  const [companies, contacts, contexts, sourceMatches] = await Promise.all([
    supabase.from("company").select("id").ilike("name", q),
    supabase.from("contact").select("id").ilike("name", q),
    supabase.from("context").select("id").ilike("title", q),
    supabase.from("case_source_link").select("case_id").ilike("raw_excerpt", q),
  ]);

  const companyIds = (companies.data ?? []).map((c) => c.id);
  const contactIds = (contacts.data ?? []).map((c) => c.id);
  const contextIds = (contexts.data ?? []).map((c) => c.id);
  const caseIdsFromSources = Array.from(new Set((sourceMatches.data ?? []).map((s) => s.case_id)));

  const orParts = [`title.ilike.${q}`, `reference_value.ilike.${q}`, `next_action.ilike.${q}`, `waiting_for.ilike.${q}`];
  if (companyIds.length) orParts.push(`company_id.in.(${companyIds.join(",")})`);
  if (contactIds.length) orParts.push(`contact_id.in.(${contactIds.join(",")})`);
  if (contextIds.length) orParts.push(`context_id.in.(${contextIds.join(",")})`);
  if (caseIdsFromSources.length) orParts.push(`id.in.(${caseIdsFromSources.join(",")})`);

  const { data, error } = await supabase.from("case").select("*").or(orParts.join(",")).order("last_activity_at", { ascending: false }).limit(50);

  if (error) throw error;
  return (data ?? []) as CaseRow[];
}
