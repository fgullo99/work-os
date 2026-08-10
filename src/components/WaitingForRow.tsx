"use client";

import { daysBetweenISO } from "@/lib/dates/calendarMath";
import { formatDateShortEs } from "@/lib/format/date";
import type { LatestSourceInfo } from "@/lib/workItems/queries";
import type { WorkItemWithRelations } from "@/lib/workItems/types";
import { SourceBadge } from "./SourceBadge";

interface Props {
  item: WorkItemWithRelations & { latestSource?: LatestSourceInfo | null };
  todayISO: string;
  onReceived: () => void;
  onExtend: () => void;
  onEdit: () => void;
}

export function WaitingForRow({ item, todayISO, onReceived, onExtend, onEdit }: Props) {
  const overdueDays =
    item.expected_date && item.expected_date < todayISO ? daysBetweenISO(item.expected_date, todayISO) : 0;
  const personLabel = item.waiting_for_contact?.name ?? "Sin persona asignada";
  const contextLabel = item.company?.name ?? item.context?.title ?? item.title;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-l-4 py-3 pl-3 ${
        overdueDays > 0 ? "border-l-waiting-600" : "border-l-ink-100"
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onEdit} className="text-left text-sm font-semibold text-ink-900 hover:text-accent-600">
            {personLabel}
          </button>
          {item.latestSource && (
            <SourceBadge source={item.latestSource.source_type} via={item.latestSource.via} demo={item.is_demo} />
          )}
        </div>
        <p className="text-sm text-ink-600">{item.waiting_for_what}</p>
        <p className="text-xs text-ink-400">{contextLabel}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-right">
          <p className="text-xs font-medium text-ink-600">
            {item.expected_date ? formatDateShortEs(item.expected_date) : "Sin fecha"}
          </p>
          {overdueDays > 0 && (
            <p className="text-xs font-medium text-risk-600">
              {overdueDays} dia{overdueDays === 1 ? "" : "s"} atraso
            </p>
          )}
        </div>
        <button type="button" onClick={onReceived} className="btn-primary">
          Received
        </button>
        <button type="button" onClick={onExtend} className="btn-secondary">
          Extend
        </button>
      </div>
    </div>
  );
}
