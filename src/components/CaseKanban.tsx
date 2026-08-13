"use client";

import type { CaseRow, CompanyRow } from "@/lib/supabase/types";
import { CaseCard } from "./CaseCard";

interface Props {
  kanban: {
    actionMe: CaseRow[];
    waitingExternal: CaseRow[];
    delegatedInternal: CaseRow[];
    blocked: CaseRow[];
  };
  companies: CompanyRow[];
  onOpenCase: (id: string) => void;
}

const COLUMNS: { key: keyof Props["kanban"]; label: string }[] = [
  { key: "actionMe", label: "ACCIÓN MÍA" },
  { key: "waitingExternal", label: "ESPERANDO" },
  { key: "delegatedInternal", label: "DELEGADO" },
  { key: "blocked", label: "EN RIESGO" },
];

/** Tablero principal de Cases (item 20-21) — 4 columnas por current_state, sin
 * drag-and-drop (item 36: se prioriza estabilidad/claridad sobre esa interaccion). Cambiar
 * de estado se hace desde el drawer (click en la card). */
export function CaseKanban({ kanban, companies, onOpenCase }: Props) {
  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {COLUMNS.map(({ key, label }) => {
        const items = kanban[key];
        return (
          <div key={key} className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</h3>
              <span className="text-xs text-ink-400">{items.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-ink-100 p-4 text-center text-xs text-ink-400">Nada acá.</div>
              ) : (
                items.map((c) => (
                  <CaseCard key={c.id} caseRow={c} companyName={c.company_id ? companyNameById.get(c.company_id) : null} onOpen={() => onOpenCase(c.id)} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
