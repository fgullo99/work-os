"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompanyRow, ContactRow, ContextRow, ReviewItemRow } from "@/lib/supabase/types";
import type { DashboardData, RecentActivityRow } from "@/lib/workItems/queries";
import { AppShell } from "./AppShell";
import { RightPanel } from "./RightPanel";
import { DashboardHeader } from "./DashboardHeader";
import { WorkItemCard } from "./WorkItemCard";
import { WaitingForRow } from "./WaitingForRow";
import { AtRiskRow } from "./AtRiskRow";
import { Collapsible } from "./Collapsible";
import { CaptureModal } from "./CaptureModal";
import { WorkItemDetailSheet } from "./WorkItemDetailSheet";
import { DatePickerModal } from "./DatePickerModal";
import { DelegateModal } from "./DelegateModal";
import { ReviewCard } from "./ReviewCard";

interface Props {
  userFirstName: string;
  todayISO: string;
  data: DashboardData;
  companies: CompanyRow[];
  contacts: ContactRow[];
  contexts: ContextRow[];
  reviewItems: ReviewItemRow[];
  gmailConnected: boolean;
  gmailEmail: string | null;
  gmailLastSyncedAt: string | null;
  recentActivity: RecentActivityRow[];
  assistantObservations: string[];
}

const REVIEW_PREVIEW_COUNT = 5;

export function DashboardClient({
  userFirstName,
  todayISO,
  data,
  companies,
  contacts,
  contexts,
  reviewItems,
  gmailConnected,
  gmailEmail,
  gmailLastSyncedAt,
  recentActivity,
  assistantObservations,
}: Props) {
  const router = useRouter();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [quickPostponeId, setQuickPostponeId] = useState<string | null>(null);
  const [quickDelegateId, setQuickDelegateId] = useState<string | null>(null);
  const [quickExtendId, setQuickExtendId] = useState<string | null>(null);
  const [showAllReview, setShowAllReview] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("capture") === "1") {
      setCaptureOpen(true);
      window.history.replaceState({}, "", "/dashboard");
    }
  }, []);

  async function postAction(id: string, path: string, body?: Record<string, unknown>) {
    await fetch(`/api/work-items/${id}/${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    router.refresh();
  }

  const visibleReviewItems = showAllReview ? reviewItems : reviewItems.slice(0, REVIEW_PREVIEW_COUNT);

  return (
    <AppShell
      userFirstName={userFirstName}
      gmailConnected={gmailConnected}
      gmailEmail={gmailEmail}
      onOpenCapture={() => setCaptureOpen(true)}
      rightPanel={
        <RightPanel
          gmailConnected={gmailConnected}
          gmailEmail={gmailEmail}
          gmailLastSyncedAt={gmailLastSyncedAt}
          recentActivity={recentActivity}
          assistantObservations={assistantObservations}
        />
      }
    >
      <DashboardHeader
        userFirstName={userFirstName}
        todayISO={todayISO}
        counts={{ ...data.counts, review: reviewItems.length }}
      />

      <div className="space-y-5">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-800">HOY</h2>
          {data.todayItems.length === 0 ? (
            <div className="card p-6 text-center text-sm text-ink-400">No hay nada urgente para hoy.</div>
          ) : (
            <div className="space-y-3">
              {data.todayItems.map((item) => (
                <WorkItemCard
                  key={item.id}
                  item={item}
                  onDone={() => postAction(item.id, "done")}
                  onPostpone={() => setQuickPostponeId(item.id)}
                  onDelegate={() => setQuickDelegateId(item.id)}
                  onEdit={() => setDetailId(item.id)}
                />
              ))}
            </div>
          )}
        </section>

        <Collapsible title="EN RIESGO" count={data.atRiskItems.length}>
          {data.atRiskItems.length === 0 ? (
            <p className="text-sm text-ink-400">Sin riesgos detectados.</p>
          ) : (
            <div className="divide-y divide-ink-100">
              {data.atRiskItems.map((item) => (
                <AtRiskRow key={item.id} item={item} onEdit={() => setDetailId(item.id)} />
              ))}
            </div>
          )}
        </Collapsible>

        <Collapsible title="ESPERANDO" count={data.waitingForItems.length}>
          {data.waitingForItems.length === 0 ? (
            <p className="text-sm text-ink-400">No estas esperando nada registrado.</p>
          ) : (
            <div className="divide-y divide-ink-100">
              {data.waitingForItems.map((item) => (
                <WaitingForRow
                  key={item.id}
                  item={item}
                  todayISO={todayISO}
                  onReceived={() => postAction(item.id, "received")}
                  onExtend={() => setQuickExtendId(item.id)}
                  onEdit={() => setDetailId(item.id)}
                />
              ))}
            </div>
          )}
        </Collapsible>

        <section id="review" className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-800">REVIEW ({reviewItems.length})</h2>
            {reviewItems.length > REVIEW_PREVIEW_COUNT && (
              <button type="button" className="btn-ghost" onClick={() => setShowAllReview((v) => !v)}>
                {showAllReview ? "Ver menos" : `Ver todas (${reviewItems.length})`}
              </button>
            )}
          </div>
          {reviewItems.length === 0 ? (
            <p className="mt-3 text-sm text-ink-400">Todo revisado.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {visibleReviewItems.map((item) => (
                <ReviewCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>
      </div>

      <CaptureModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        companies={companies}
        contacts={contacts}
        contexts={contexts}
      />

      <WorkItemDetailSheet
        workItemId={detailId}
        onClose={() => setDetailId(null)}
        companies={companies}
        contacts={contacts}
        contexts={contexts}
        todayISO={todayISO}
      />

      <DatePickerModal
        open={Boolean(quickPostponeId)}
        title="Postpone"
        todayISO={todayISO}
        onClose={() => setQuickPostponeId(null)}
        onConfirm={(dateISO) => {
          if (quickPostponeId) postAction(quickPostponeId, "postpone", { until: dateISO });
          setQuickPostponeId(null);
        }}
      />

      <DatePickerModal
        open={Boolean(quickExtendId)}
        title="Extend"
        todayISO={todayISO}
        onClose={() => setQuickExtendId(null)}
        onConfirm={(dateISO) => {
          if (quickExtendId) postAction(quickExtendId, "extend", { expected_date: dateISO });
          setQuickExtendId(null);
        }}
      />

      <DelegateModal
        open={Boolean(quickDelegateId)}
        contacts={contacts}
        todayISO={todayISO}
        onClose={() => setQuickDelegateId(null)}
        onConfirm={(responsibleId, expectedDateISO) => {
          if (quickDelegateId)
            postAction(quickDelegateId, "delegate", { responsible_id: responsibleId, expected_date: expectedDateISO });
          setQuickDelegateId(null);
        }}
      />
    </AppShell>
  );
}
