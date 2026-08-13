import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchWorkItems } from "@/lib/workItems/queries";
import { listCompanies, listContacts, listContexts } from "@/lib/workItems/entities";
import { searchCases } from "@/lib/cases/search";
import { todayInTimezone } from "@/lib/dates/timezone";
import { getActiveConnection } from "@/lib/google/connection";
import { SearchClient } from "@/components/SearchClient";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const supabase = createSupabaseServerClient();
  const query = searchParams.q ?? "";

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [results, cases, companies, contacts, contexts, connection] = await Promise.all([
    searchWorkItems(supabase, query),
    searchCases(supabase, query),
    listCompanies(supabase),
    listContacts(supabase),
    listContexts(supabase),
    getActiveConnection(supabase),
  ]);

  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? "";
  const firstName = fullName.split(" ")[0] || "de nuevo";

  return (
    <SearchClient
      initialQuery={query}
      results={results}
      cases={cases}
      companies={companies}
      contacts={contacts}
      contexts={contexts}
      todayISO={todayInTimezone()}
      userFirstName={firstName}
      gmailConnected={Boolean(connection)}
      gmailEmail={connection?.email ?? null}
    />
  );
}
