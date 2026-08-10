import type { DashboardData } from "@/lib/workItems/queries";
import type { ReviewItemRow } from "@/lib/supabase/types";

/**
 * Observaciones deterministicas sobre datos ya calculados por el dashboard (priority/risk
 * engines + review tray). No llama a ningun modelo: es texto de plantilla sobre numeros y
 * titulos que ya existen. Se recalcula en cada render, sin costo de API.
 */
export function buildAssistantObservations(data: DashboardData, reviewItems: ReviewItemRow[]): string[] {
  const observations: string[] = [];

  const topItem = data.todayItems[0];
  if (topItem) {
    observations.push(`Tu prioridad mas alta ahora es: "${topItem.title}".`);
  } else {
    observations.push("No tenes prioridades urgentes en este momento.");
  }

  if (data.atRiskItems.length > 0) {
    observations.push(
      `${data.atRiskItems.length} item${data.atRiskItems.length === 1 ? "" : "s"} en riesgo requieren atencion.`
    );
  }

  if (reviewItems.length > 0) {
    observations.push(
      `${reviewItems.length} sugerencia${reviewItems.length === 1 ? "" : "s"} esperando tu revision.`
    );
  }

  return observations.slice(0, 3);
}
