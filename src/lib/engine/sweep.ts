import type { WorkItemRow } from "@/lib/supabase/types";
import { daysBetweenISO } from "@/lib/dates/calendarMath";
import { isSomeoneWaiting } from "./priority";

export interface StaleWorkItem {
  id: string;
  title: string;
  daysSinceActivity: number;
}

export interface SweepSummary {
  /** Items activos sin actividad hace 15+ dias — candidatos a "me olvide de esto",
   * ordenados por mas viejo primero. Distinto de AT RISK (computeRisk), que solo mira
   * fechas de vencimiento/espera explicitas. */
  staleItems: StaleWorkItem[];
  someoneWaitingCount: number;
}

const STALE_THRESHOLD_DAYS = 15;

/**
 * Sweep deterministico (sin IA, sin llamadas de red) sobre los Work Items activos ya
 * traidos por getDashboardData — alimenta el Morning Brief (buildAssistantObservations).
 * No decide ni cierra nada, solo detecta señales para mostrar. Ver plan seccion "Sweep
 * deterministico".
 */
export function computeSweep(items: WorkItemRow[], todayISO: string): SweepSummary {
  const staleItems: StaleWorkItem[] = [];
  let someoneWaitingCount = 0;

  for (const item of items) {
    if (item.status !== "OPEN" && item.status !== "DELEGATED") continue;

    if (isSomeoneWaiting(item)) someoneWaitingCount += 1;

    const referenceDate = item.last_activity_at ? item.last_activity_at.slice(0, 10) : null;
    if (referenceDate) {
      const days = daysBetweenISO(referenceDate, todayISO);
      if (days >= STALE_THRESHOLD_DAYS) {
        staleItems.push({ id: item.id, title: item.title, daysSinceActivity: days });
      }
    }
  }

  staleItems.sort((a, b) => b.daysSinceActivity - a.daysSinceActivity);
  return { staleItems, someoneWaitingCount };
}
