import type { WorkItemRow } from "@/lib/supabase/types";
import { daysBetweenISO } from "@/lib/dates/calendarMath";
import { formatDateShortEs } from "@/lib/format/date";

export interface RiskResult {
  isAtRisk: boolean;
  reasons: string[];
}

/**
 * AT RISK no es un estado guardado en la base — es esta funcion, evaluada en cada
 * lectura del dashboard. Ver Work OS MVP Spec, seccion 9. Reglas: OVERDUE,
 * COMMITMENT_AT_RISK, WAITING_OVERDUE, amplificadas por BLOCKING.
 */
export function computeRisk(item: WorkItemRow, todayISO: string): RiskResult {
  const reasons: string[] = [];

  if (item.status !== "OPEN" && item.status !== "DELEGATED") {
    return { isAtRisk: false, reasons: [] };
  }

  if (item.due_date && item.due_date < todayISO) {
    reasons.push(`Vencido desde ${formatDateShortEs(item.due_date)}`);
  }

  if (item.committed_date && item.committed_date < todayISO) {
    reasons.push(`Compromiso incumplido, vencia el ${formatDateShortEs(item.committed_date)}`);
  }

  if (item.waiting_for_what && item.expected_date && item.expected_date < todayISO) {
    const days = daysBetweenISO(item.expected_date, todayISO);
    reasons.push(`Esperando hace ${days} dia${days === 1 ? "" : "s"} de atraso`);
  }

  if (reasons.length > 0 && item.blocking) {
    reasons.push(item.blocking_note ? `Bloquea: ${item.blocking_note}` : "Bloquea otra actividad");
  }

  return { isAtRisk: reasons.length > 0, reasons };
}
