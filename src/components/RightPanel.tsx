import { SourcesStatus } from "./SourcesStatus";
import { RecentActivity } from "./RecentActivity";
import { CalendarPreview } from "./CalendarPreview";
import { AssistantSummary } from "./AssistantSummary";
import type { RecentActivityRow } from "@/lib/workItems/queries";

interface Props {
  gmailConnected: boolean;
  gmailEmail?: string | null;
  gmailLastSyncedAt?: string | null;
  recentActivity: RecentActivityRow[];
  assistantObservations: string[];
}

export function RightPanel({
  gmailConnected,
  gmailEmail,
  gmailLastSyncedAt,
  recentActivity,
  assistantObservations,
}: Props) {
  return (
    <div className="space-y-4">
      <SourcesStatus gmailConnected={gmailConnected} gmailEmail={gmailEmail} gmailLastSyncedAt={gmailLastSyncedAt} />
      <RecentActivity entries={recentActivity} />
      <CalendarPreview />
      <AssistantSummary observations={assistantObservations} />
    </div>
  );
}
