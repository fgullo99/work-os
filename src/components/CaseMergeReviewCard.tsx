"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewItemRow } from "@/lib/supabase/types";
import { Badge } from "./Badge";
import { SourceBadge } from "./SourceBadge";
import { useToast } from "./Toast";

interface CaseMergeReviewPayload {
  threadSubject: string;
  suggestedTitle: string;
  extractedReference: { type: string; value: string } | null;
  candidateTitles: string[];
  reason: string;
}

/** Review card para CASE_MERGE_REVIEW (item 17-18): Felipe elige vincular el thread a uno de
 * los Cases candidatos, o crear un Case nuevo — nunca se auto-mergea algo ambiguo. */
export function CaseMergeReviewCard({ item }: { item: ReviewItemRow }) {
  const router = useRouter();
  const toast = useToast();
  const payload = item.proposed_payload as unknown as CaseMergeReviewPayload;
  const candidateIds = item.duplicate_candidate_ids ?? [];
  const candidates = candidateIds.map((id, i) => ({ id, title: payload.candidateTitles?.[i] ?? id }));
  const [selectedId, setSelectedId] = useState<string>(candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function post(path: string, body?: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/cases/merge-review/${item.id}/${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      router.refresh();
    } catch (err) {
      console.error(`[case-merge-review] ${path} fallo:`, err);
      toast.show("No se pudo aplicar la accion. Reintentá.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={item.source_type} demo={item.is_demo} />
        <Badge tone="neutral">Posible mismo Case</Badge>
        <Badge tone={item.confidence === "MEDIUM" ? "waiting" : "neutral"}>{item.confidence}</Badge>
      </div>

      <p className="mt-2 text-[15px] font-semibold text-ink-900">{payload.suggestedTitle}</p>
      <p className="mt-1 text-xs text-ink-500">{payload.threadSubject}</p>
      {item.rationale && <p className="mt-1 text-sm text-ink-600">{item.rationale}</p>}

      {candidates.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Vincular a Case existente</p>
          {candidates.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="radio"
                name={`merge-target-${item.id}`}
                checked={selectedId === c.id}
                onChange={() => setSelectedId(c.id)}
              />
              {c.title}
            </label>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
        {candidates.length > 0 && (
          <button
            type="button"
            disabled={busy}
            className="btn-primary"
            onClick={() => post("accept", { targetCaseId: selectedId })}
          >
            Vincular
          </button>
        )}
        <button type="button" disabled={busy} className="btn-secondary" onClick={() => post("accept")}>
          Crear Case nuevo
        </button>
        <button type="button" disabled={busy} className="btn-ghost" onClick={() => post("ignore")}>
          Ignore
        </button>
      </div>
    </div>
  );
}
