"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewItemRow } from "@/lib/supabase/types";
import { Badge } from "./Badge";
import { SourceBadge } from "./SourceBadge";
import { useToast } from "./Toast";

interface CaseStateReviewPayload {
  caseTitle: string;
  proposedState: {
    current_state: string;
    current_owner: string;
    next_action: string | null;
    waiting_for: string | null;
    last_meaningful_event: string;
    risk: string;
  };
  summary: string;
}

/** Review card para CASE_STATE_REVIEW (item 19-20): la IA reanalizo el Case completo pero el
 * gate lo mando a revision (owner UNKNOWN, confidence LOW, o CLOSED sin evidencia inequivoca —
 * ver applyCaseStateGate). Felipe confirma el estado propuesto tal cual, sin volver a llamar
 * a la IA (acceptCaseStateReview no gasta tokens nuevos). */
export function CaseStateReviewCard({ item }: { item: ReviewItemRow }) {
  const router = useRouter();
  const toast = useToast();
  const payload = item.proposed_payload as unknown as CaseStateReviewPayload;
  const [busy, setBusy] = useState(false);

  async function post(path: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/cases/state-review/${item.id}/${path}`, { method: "POST" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      router.refresh();
    } catch (err) {
      console.error(`[case-state-review] ${path} fallo:`, err);
      toast.show("No se pudo aplicar la accion. Reintentá.");
    } finally {
      setBusy(false);
    }
  }

  const s = payload.proposedState;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={item.source_type} demo={item.is_demo} />
        <Badge tone="neutral">Confirmar estado</Badge>
        <Badge tone={item.confidence === "HIGH" ? "action" : item.confidence === "MEDIUM" ? "waiting" : "neutral"}>
          {item.confidence}
        </Badge>
      </div>

      <p className="mt-2 text-[15px] font-semibold text-ink-900">{payload.caseTitle}</p>
      <p className="mt-1 text-sm text-ink-600">{payload.summary}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-ink-100 px-2 py-0.5 font-semibold text-ink-600">{s.current_state}</span>
        <span className="text-ink-400">owner: {s.current_owner}</span>
        {s.risk === "AT_RISK" && <Badge tone="blocking">EN RIESGO</Badge>}
      </div>

      {s.next_action && <p className="mt-2 text-sm text-ink-700">Accion: {s.next_action}</p>}
      {s.waiting_for && <p className="mt-1 text-sm text-ink-700">Esperando: {s.waiting_for}</p>}
      <p className="mt-1 text-xs text-ink-500">Ahora: {s.last_meaningful_event}</p>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
        <button type="button" disabled={busy} className="btn-primary" onClick={() => post("accept")}>
          Confirmar
        </button>
        <button type="button" disabled={busy} className="btn-ghost" onClick={() => post("ignore")}>
          Ignore
        </button>
      </div>
    </div>
  );
}
