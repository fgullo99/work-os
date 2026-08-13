"use client";

import type { CaseRow, CompanyRow } from "@/lib/supabase/types";
import { CaseCard } from "./CaseCard";

interface Props {
  cases: CaseRow[];
  companies: CompanyRow[];
  onOpenCase: (id: string) => void;
}

/**
 * Seccion horizontal EN RIESGO — TODOS los Cases con risk=AT_RISK, sin importar su
 * current_state (una card puede estar aca Y en su columna operativa del Kanban al mismo
 * tiempo, ver board.ts:atRiskCases). No es una columna del Kanban: risk y current_state son
 * dos dimensiones independientes, nunca deben competir por el mismo lugar en pantalla.
 */
export function CaseAtRiskSection({ cases, companies, onOpenCase }: Props) {
  if (cases.length === 0) return null;
  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {cases.map((c) => (
        <div key={c.id} className="w-72 shrink-0">
          <CaseCard caseRow={c} companyName={c.company_id ? companyNameById.get(c.company_id) : null} onOpen={() => onOpenCase(c.id)} />
        </div>
      ))}
    </div>
  );
}
