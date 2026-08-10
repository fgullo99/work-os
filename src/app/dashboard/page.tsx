import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDashboardData, getRecentActivity } from "@/lib/workItems/queries";
import { listCompanies, listContacts, listContexts } from "@/lib/workItems/entities";
import { listPendingReviewItems } from "@/lib/workItems/reviewItems";
import { todayInTimezone } from "@/lib/dates/timezone";
import { getActiveConnection } from "@/lib/google/connection";
import { buildAssistantObservations } from "@/lib/assistant/summary";
import { DashboardClient } from "@/components/DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createSupabaseServerClient();
  const todayISO = todayInTimezone();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [dashboardData, companies, contacts, contexts, reviewItems, connection, recentActivity] = await Promise.all([
    getDashboardData(supabase, todayISO),
    listCompanies(supabase),
    listContacts(supabase),
    listContexts(supabase),
    listPendingReviewItems(supabase),
    getActiveConnection(supabase),
    getRecentActivity(supabase, 6),
  ]);

  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? "";
  const firstName = fullName.split(" ")[0] || "de nuevo";
  const assistantObservations = buildAssistantObservations(dashboardData, reviewItems);

  return (
    <DashboardClient
      userFirstName={firstName}
      todayISO={todayISO}
      data={dashboardData}
      companies={companies}
      contacts={contacts}
      contexts={contexts}
      reviewItems={reviewItems}
      gmailConnected={Boolean(connection)}
      gmailEmail={connection?.email ?? null}
      gmailLastSyncedAt={connection?.last_synced_at ?? null}
      recentActivity={recentActivity}
      assistantObservations={assistantObservations}
    />
  );
}
