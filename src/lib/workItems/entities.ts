import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { CompanyRow, ContactRow, ContactTier, ContextRow } from "@/lib/supabase/types";

type DB = SupabaseServerClient;

// ---------- Company ----------

export async function listCompanies(supabase: DB): Promise<CompanyRow[]> {
  const { data, error } = await supabase.from("company").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function createCompany(supabase: DB, input: { name: string; notes?: string | null }): Promise<CompanyRow> {
  const { data, error } = await supabase.from("company").insert({ name: input.name, notes: input.notes ?? null }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCompany(supabase: DB, id: string): Promise<void> {
  const { error } = await supabase.from("company").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Contact ----------

export async function listContacts(supabase: DB): Promise<ContactRow[]> {
  const { data, error } = await supabase.from("contact").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function createContact(
  supabase: DB,
  input: { name: string; email?: string | null; phone_e164?: string | null; company_id?: string | null; tier?: ContactTier }
): Promise<ContactRow> {
  const { data, error } = await supabase
    .from("contact")
    .insert({
      name: input.name,
      email: input.email ?? null,
      phone_e164: input.phone_e164 ?? null,
      company_id: input.company_id ?? null,
      tier: input.tier ?? "B",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteContact(supabase: DB, id: string): Promise<void> {
  const { error } = await supabase.from("contact").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Context ----------

export async function listContexts(supabase: DB): Promise<ContextRow[]> {
  const { data, error } = await supabase.from("context").select("*").order("title");
  if (error) throw error;
  return data ?? [];
}

export async function createContext(
  supabase: DB,
  input: { title: string; company_id?: string | null; notes?: string | null }
): Promise<ContextRow> {
  const { data, error } = await supabase
    .from("context")
    .insert({ title: input.title, company_id: input.company_id ?? null, notes: input.notes ?? null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteContext(supabase: DB, id: string): Promise<void> {
  const { error } = await supabase.from("context").delete().eq("id", id);
  if (error) throw error;
}

export { findBestMatch } from "./match";
