"use client";

import type { CaseRow } from "@/lib/supabase/types";
import { formatDateShortEs, formatRelativeEs } from "@/lib/format/date";
import { Badge } from "./Badge";

const OWNER_LABEL: Record<string, string> = {
  FELIPE: "Vos",
  TEAM: "Equipo",
  EXTERNAL: "Externo",
  NONE: "Nadie",
  UNKNOWN: "?",
};

interface Props {
  caseRow: CaseRow;
  companyName?: string | null;
  onOpen: () => void;
}

/**
 * Card compacta de Kanban — un Case, nunca un email individual (item 23). Muestra solo lo
 * pedido: company, referencia, titulo, estado/owner, next_action/waiting_for, ultimo evento,
 * antiguedad, riesgo.
 */
export function CaseCard({ caseRow: c, companyName, onOpen }: Props) {
  const reference = c.reference_value ? `${c.reference_type ?? ""} ${c.reference_value}`.trim() : null;
  const nextLine = c.next_action ?? c.waiting_for;
  const isAtRisk = c.risk === "AT_RISK";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`card w-full border-l-4 p-3 text-left ${isAtRisk || c.current_state === "BLOCKED" ? "border-l-risk-600" : "border-l-accent-500"}`}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
        {companyName && <span className="truncate">{companyName}</span>}
        {reference && <span className="text-ink-500">{reference}</span>}
      </div>

      <p className="mt-0.5 truncate text-[14px] font-semibold text-ink-900">{c.title}</p>

      {nextLine && <p className="mt-1 truncate text-sm text-ink-700">{nextLine}</p>}
      {c.last_meaningful_event && <p className="mt-0.5 truncate text-xs text-ink-500">{c.last_meaningful_event}</p>}

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{OWNER_LABEL[c.current_owner] ?? c.current_owner}</Badge>
        {isAtRisk && <Badge tone="blocking">EN RIESGO</Badge>}
        {c.due_date && <span className="text-[11px] text-ink-500">Vence {formatDateShortEs(c.due_date)}</span>}
        <span className="text-[11px] text-ink-400">{formatRelativeEs(c.last_activity_at)}</span>
      </div>
    </button>
  );
}
