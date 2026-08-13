"use client";

import { useEffect, useState } from "react";
import type { CompanyRow, ContactRow, ContextRow, ReviewItemRow } from "@/lib/supabase/types";
import type { DashboardData, RecentActivityRow } from "@/lib/workItems/queries";
import type { CaseBoardData } from "@/lib/cases/board";
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
import { CaseKanban } from "./CaseKanban";
import { CaseCard } from "./CaseCard";
import { CaseAtRiskSection } from "./CaseAtRiskSection";
import { CaseDetailDrawer } from "./CaseDetailDrawer";
import { ToastProvider, useToast } from "./Toast";
import { runOptimisticListAction } from "@/lib/ui/optimisticListAction";

interface Props {
  userFirstName: string;
  todayISO: string;
  data: DashboardData;
  companies: CompanyRow[];
  contacts: ContactRow[];
  contexts: ContextRow[];
  reviewItems: ReviewItemRow[];
  caseBoard: CaseBoardData;
  gmailConnected: boolean;
  gmailEmail: string | null;
  gmailLastSyncedAt: string | null;
  recentActivity: RecentActivityRow[];
  assistantObservations: string[];
}

const REVIEW_PREVIEW_COUNT = 5;

export function DashboardClient(props: Props) {
  return (
    <ToastProvider>
      <DashboardClientInner {...props} />
    </ToastProvider>
  );
}

function DashboardClientInner({
  userFirstName,
  todayISO,
  data,
  companies,
  contacts,
  contexts,
  reviewItems,
  caseBoard,
  gmailConnected,
  gmailEmail,
  gmailLastSyncedAt,
  recentActivity,
  assistantObservations,
}: Props) {
  const toast = useToast();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailCaseId, setDetailCaseId] = useState<string | null>(null);
  const [quickPostponeId, setQuickPostponeId] = useState<string | null>(null);
  const [quickDelegateId, setQuickDelegateId] = useState<string | null>(null);
  const [quickExtendId, setQuickExtendId] = useState<string | null>(null);
  const [showAllReview, setShowAllReview] = useState(false);
  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));

  // Espejo local de las 3 listas para poder hacer optimistic update (sacar/actualizar una
  // card al toque, sin esperar al servidor). Se resincroniza con las props cada vez que el
  // servidor manda datos nuevos de verdad (ej: al aceptar un Review, que si sigue haciendo
  // router.refresh() porque ahi si aparecen items nuevos que el cliente no puede inventar).
  const [todayItems, setTodayItems] = useState(data.todayItems);
  const [atRiskItems, setAtRiskItems] = useState(data.atRiskItems);
  const [waitingForItems, setWaitingForItems] = useState(data.waitingForItems);

  useEffect(() => {
    setTodayItems(data.todayItems);
    setAtRiskItems(data.atRiskItems);
    setWaitingForItems(data.waitingForItems);
  }, [data]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("capture") === "1") {
      setCaptureOpen(true);
      window.history.replaceState({}, "", "/dashboard");
    }
  }, []);

  /**
   * Accion optimista sobre un item de una lista puntual (Today/Waiting): lo saca de esa
   * lista al toque (la card desaparece ya, sin esperar la respuesta), dispara el POST en
   * paralelo, y si falla lo vuelve a poner en su lugar original + toast de error. No hace
   * router.refresh() — el resto de las listas se resincronizan solas la proxima vez que el
   * servidor mande props nuevas (ej: al aceptar un Review). Logica real en
   * src/lib/ui/optimisticListAction.ts (extraida para poder testearla sin montar el
   * Dashboard completo).
   */
  async function postActionOptimistic<T extends { id: string }>(
    id: string,
    path: string,
    currentList: T[],
    setList: React.Dispatch<React.SetStateAction<T[]>> | null,
    body?: Record<string, unknown>
  ) {
    await runOptimisticListAction({
      id,
      path,
      currentList,
      setList: setList ?? (() => {}),
      body,
      onError: () => toast.show("No se pudo aplicar el cambio, se deshizo. Reintentá."),
    });
  }

  function handleDone(id: string) {
    postActionOptimistic(id, "done", todayItems, setTodayItems);
  }

  function handleReceived(id: string) {
    postActionOptimistic(id, "received", waitingForItems, setWaitingForItems);
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
        counts={{
          today: caseBoard.counts.hoy,
          atRisk: caseBoard.counts.enRiesgo,
          waiting: caseBoard.counts.esperando,
          review: reviewItems.length,
        }}
      />

      <div className="space-y-5">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-800">HOY</h2>
          {caseBoard.hoyCases.length === 0 ? (
            <div className="card p-6 text-center text-sm text-ink-400">No hay nada urgente para hoy.</div>
          ) : (
            <div className="space-y-3">
              {caseBoard.hoyCases.map((c) => (
                <CaseCard key={c.id} caseRow={c} companyName={c.company_id ? companyNameById.get(c.company_id) : null} onOpen={() => setDetailCaseId(c.id)} />
              ))}
            </div>
          )}
        </section>

        {caseBoard.atRiskCases.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink-800">EN RIESGO ({caseBoard.atRiskCases.length})</h2>
            <CaseAtRiskSection cases={caseBoard.atRiskCases} companies={companies} onOpenCase={(id) => setDetailCaseId(id)} />
          </section>
        )}

        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-800">CASES</h2>
          <CaseKanban kanban={caseBoard.kanban} companies={companies} onOpenCase={(id) => setDetailCaseId(id)} />
        </section>

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

        <Collapsible title="WORK ITEMS (LEGACY) — EN RIESGO" count={atRiskItems.length}>
          {atRiskItems.length === 0 ? (
            <p className="text-sm text-ink-400">Sin riesgos detectados.</p>
          ) : (
            <div className="divide-y divide-ink-100">
              {atRiskItems.map((item) => (
                <AtRiskRow key={item.id} item={item} onEdit={() => setDetailId(item.id)} />
              ))}
            </div>
          )}
        </Collapsible>

        <Collapsible title="WORK ITEMS (LEGACY) — ESPERANDO" count={waitingForItems.length}>
          {waitingForItems.length === 0 ? (
            <p className="text-sm text-ink-400">No estas esperando nada registrado.</p>
          ) : (
            <div className="divide-y divide-ink-100">
              {waitingForItems.map((item) => (
                <WaitingForRow
                  key={item.id}
                  item={item}
                  todayISO={todayISO}
                  onReceived={() => handleReceived(item.id)}
                  onExtend={() => setQuickExtendId(item.id)}
                  onEdit={() => setDetailId(item.id)}
                />
              ))}
            </div>
          )}
        </Collapsible>

        <Collapsible title="WORK ITEMS (LEGACY) — HOY" count={todayItems.length}>
          {todayItems.length === 0 ? (
            <p className="text-sm text-ink-400">Nada pendiente.</p>
          ) : (
            <div className="space-y-3">
              {todayItems.map((item) => (
                <WorkItemCard
                  key={item.id}
                  item={item}
                  onDone={() => handleDone(item.id)}
                  onPostpone={() => setQuickPostponeId(item.id)}
                  onDelegate={() => setQuickDelegateId(item.id)}
                  onEdit={() => setDetailId(item.id)}
                />
              ))}
            </div>
          )}
        </Collapsible>
      </div>

      <CaseDetailDrawer caseId={detailCaseId} onClose={() => setDetailCaseId(null)} />

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
          if (quickPostponeId) postActionOptimistic(quickPostponeId, "postpone", todayItems, setTodayItems, { until: dateISO });
          setQuickPostponeId(null);
        }}
      />

      <DatePickerModal
        open={Boolean(quickExtendId)}
        title="Extend"
        todayISO={todayISO}
        onClose={() => setQuickExtendId(null)}
        onConfirm={(dateISO) => {
          if (quickExtendId) {
            const id = quickExtendId;
            setWaitingForItems((items) => items.map((i) => (i.id === id ? { ...i, expected_date: dateISO } : i)));
            fetch(`/api/work-items/${id}/extend`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ expected_date: dateISO }),
            }).catch((err) => {
              console.error("[dashboard] extend fallo:", err);
              toast.show("No se pudo extender la fecha. Reintentá.");
            });
          }
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
            postActionOptimistic(quickDelegateId, "delegate", todayItems, setTodayItems, {
              responsible_id: responsibleId,
              expected_date: expectedDateISO,
            });
          setQuickDelegateId(null);
        }}
      />
    </AppShell>
  );
}
