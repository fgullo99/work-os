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

  // Today/At Risk/Waiting/Review son el nucleo del Dashboard — si estas fallan, no hay
  // nada util que mostrar y se deja propagar el error. Gmail status y Recent Activity son
  // secundarios (paneles auxiliares del RightPanel): si fallan, el Dashboard sigue andando
  // sin ellos en vez de tumbar toda la pagina (un solo review_item o source_link con datos
  // raros no debe dejar a Felipe sin poder ver sus tareas de hoy).
  const [dashboardData, companies, contacts, contexts, reviewItems] = await Promise.all([
    getDashboardData(supabase, todayISO),
    listCompanies(supabase),
    listContacts(supabase),
    listContexts(supabase),
    listPendingReviewItems(supabase),
  ]);

  const [connection, recentActivity] = await Promise.all([
    getActiveConnection(supabase).catch((err) => {
      console.error("[dashboard] getActiveConnection fallo, se muestra sin estado de Gmail:", err);
      return null;
    }),
    getRecentActivity(supabase, 6).catch((err) => {
      console.error("[dashboard] getRecentActivity fallo, se muestra sin Recent Activity:", err);
      return [];
    }),
  ]);

  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? "";
  const firstName = fullName.split(" ")[0] || "de nuevo";
  const assistantObservations = buildAssistantObservations(dashboardData, reviewItems, connection?.last_reconciliation_summary ?? null);

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
