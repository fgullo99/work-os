import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listCompanies, listContacts, listContexts } from "@/lib/workItems/entities";
import { getActiveConnection } from "@/lib/google/connection";
import { getAIProvider } from "@/lib/ai";
import { SettingsClient } from "@/components/SettingsClient";

export const dynamic = "force-dynamic";

/** No dejamos que Settings se rompa si ANTHROPIC_API_KEY todavia no esta configurada —
 * el panel AI Engine simplemente muestra "not configured" en ese caso. */
function getAiEngineInfo(): { provider: string; model: string } {
  const provider = process.env.AI_PROVIDER ?? "anthropic";
  try {
    return { provider, model: getAIProvider().getModel() };
  } catch {
    return { provider, model: "not configured" };
  }
}

export default async function SettingsPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [companies, contacts, contexts, connection] = await Promise.all([
    listCompanies(supabase),
    listContacts(supabase),
    listContexts(supabase),
    getActiveConnection(supabase),
  ]);

  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? "";
  const firstName = fullName.split(" ")[0] || "de nuevo";
  const aiEngine = getAiEngineInfo();

  return (
    <SettingsClient
      companies={companies}
      contacts={contacts}
      contexts={contexts}
      userFirstName={firstName}
      gmailConnected={Boolean(connection)}
      gmailEmail={connection?.email ?? null}
      aiProvider={aiEngine.provider}
      aiModel={aiEngine.model}
    />
  );
}
