"use client";

import { formatDateShortEs, formatRelativeEs } from "@/lib/format/date";
import type { PriorityResult } from "@/lib/engine/priority";
import type { LatestSourceInfo } from "@/lib/workItems/queries";
import type { WorkItemWithRelations } from "@/lib/workItems/types";
import { Badge } from "./Badge";
import { SourceBadge } from "./SourceBadge";

interface Props {
  item: WorkItemWithRelations & { priority: PriorityResult; latestSource?: LatestSourceInfo | null };
  onDone: () => void;
  onPostpone: () => void;
  onDelegate: () => void;
  onEdit: () => void;
}

export function WorkItemCard({ item, onDone, onPostpone, onDelegate, onEdit }: Props) {
  const deadline = item.due_date ?? item.committed_date;
  const criticality = item.blocking || item.priority.bucket === "DO_NOW" ? "risk" : item.waiting_for_what ? "waiting" : "accent";
  const borderClass = criticality === "risk" ? "border-l-risk-600" : criticality === "waiting" ? "border-l-waiting-600" : "border-l-accent-500";

  const headerParts = [item.company?.name, item.context?.title, item.category].filter(Boolean) as string[];

  return (
    <div className={`card border-l-4 p-3 ${borderClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {headerParts.length > 0 && (
            <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              {headerParts.join(" · ")}
            </p>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="text-left text-[14px] font-semibold leading-snug text-ink-900 hover:text-accent-600"
          >
            {item.title}
          </button>

          {item.next_action && (
            <p className="mt-1 text-sm text-ink-700">
              {item.next_action}
              {deadline && <span className="ml-1.5 text-xs font-medium text-ink-500">· {formatDateShortEs(deadline)}</span>}
            </p>
          )}
          {item.waiting_for_what && (
            <p className="mt-0.5 text-sm text-waiting-600">
              Esperando {item.waiting_for_contact?.name ? `de ${item.waiting_for_contact.name}: ` : ": "}
              {item.waiting_for_what}
            </p>
          )}
          {item.blocking && item.blocking_note && <p className="mt-0.5 text-sm text-risk-600">Bloquea: {item.blocking_note}</p>}

          <p className="mt-1 text-xs text-ink-500">{item.priority.why}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {item.latestSource && (
              <SourceBadge source={item.latestSource.source_type} via={item.latestSource.via} demo={item.is_demo} />
            )}
            <span className="text-[11px] text-ink-400">{formatRelativeEs(item.last_activity_at)}</span>
            {item.blocking && <Badge tone="blocking">BLOCKING</Badge>}
          </div>
          {item.latestSource?.raw_excerpt && (
            <p className="mt-1 truncate text-xs italic text-ink-400">&quot;{item.latestSource.raw_excerpt}&quot;</p>
          )}
        </div>
        {item.estimated_minutes && (
          <span className="shrink-0 text-xs text-ink-400">{item.estimated_minutes} min</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-ink-100 pt-2">
        <button type="button" onClick={onDone} className="btn-primary">
          Done
        </button>
        <button type="button" onClick={onPostpone} className="btn-secondary">
          Postpone
        </button>
        <button type="button" onClick={onDelegate} className="btn-secondary">
          Delegate
        </button>
        <button type="button" onClick={onEdit} className="btn-ghost">
          Edit
        </button>
      </div>
    </div>
  );
}
