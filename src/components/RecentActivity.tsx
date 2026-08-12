"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatRelativeEs } from "@/lib/format/date";
import { SourceBadge } from "./SourceBadge";
import type { RecentActivityRow } from "@/lib/workItems/queries";

const MAX_SHOWN = 5;

const ACTION_LABEL: Record<string, string> = {
  CREATE: "AI creo",
  UPDATE: "AI actualizo",
};

function UndoButton({ logId, onDone }: { logId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleUndo() {
    setBusy(true);
    try {
      const res = await fetch(`/api/ai-activity/${logId}/undo`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(
          data.reason === "human_activity_since"
            ? "No se pudo deshacer: alguien lo modifico despues."
            : "No se pudo deshacer."
        );
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  if (message) return <span className="text-[11px] text-ink-400">{message}</span>;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleUndo}
      className="text-[11px] font-medium text-ink-500 underline decoration-dotted hover:text-ink-700 disabled:opacity-50"
    >
      Undo
    </button>
  );
}

export function RecentActivity({ entries }: { entries: RecentActivityRow[] }) {
  const router = useRouter();
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
              {entry.aiAction && (
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[11px] font-medium text-ink-500">{ACTION_LABEL[entry.aiAction.action]}</span>
                  <UndoButton logId={entry.aiAction.logId} onDone={() => router.refresh()} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {hasMore && <p className="mt-2 text-xs text-ink-400">Ver toda la actividad: usa Search para buscar por item.</p>}
    </section>
  );
}
