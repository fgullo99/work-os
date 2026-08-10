import { formatRelativeEs } from "@/lib/format/date";
import { SourceBadge } from "./SourceBadge";
import type { RecentActivityRow } from "@/lib/workItems/queries";

const MAX_SHOWN = 5;

export function RecentActivity({ entries }: { entries: RecentActivityRow[] }) {
  const visible = entries.slice(0, MAX_SHOWN);
  const hasMore = entries.length > MAX_SHOWN;

  return (
    <section className="card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">Actividad reciente</h3>
      {visible.length === 0 ? (
        <p className="mt-2 text-sm text-ink-400">Sin actividad reciente.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {visible.map((entry) => (
            <li key={entry.id} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <SourceBadge source={entry.source_type} via={entry.via} demo={entry.is_demo} />
                <span className="shrink-0 text-[11px] text-ink-400">{formatRelativeEs(entry.occurred_at)}</span>
              </div>
              <p className="mt-1 truncate text-ink-700">{entry.work_item_title}</p>
              {entry.raw_excerpt && (
                <p className="mt-0.5 truncate text-xs italic text-ink-400">&quot;{entry.raw_excerpt}&quot;</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {hasMore && <p className="mt-2 text-xs text-ink-400">Ver toda la actividad: usa Search para buscar por item.</p>}
    </section>
  );
}
