import type { DashboardData } from "@/lib/workItems/queries";
import type { ReviewItemRow } from "@/lib/supabase/types";

/**
 * Observaciones deterministicas sobre datos ya calculados por el dashboard (priority/risk/
 * sweep engines + review tray + ultimo resultado de reconciliacion). No llama a ningun
 * modelo: es texto de plantilla sobre numeros y titulos que ya existen. Se recalcula en cada
 * render, sin costo de API. `lastReconciliation` es el jsonb crudo guardado por
 * runReconciliationSweep (ver google_connection.last_reconciliation_summary) — puede venir
 * null si todavia no corrio ninguna vez, o si Gmail no esta conectado.
 */
export function buildAssistantObservations(
  data: DashboardData,
  reviewItems: ReviewItemRow[],
  lastReconciliation?: Record<string, unknown> | null
): string[] {
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

  const staleCount = data.sweep.staleItems.length;
  if (staleCount > 0) {
    const oldest = data.sweep.staleItems[0]!;
    observations.push(
      `${staleCount} item${staleCount === 1 ? "" : "s"} sin actividad hace 15+ dias — el mas viejo: "${oldest.title}" (${oldest.daysSinceActivity} dias).`
    );
  }

  if (data.sweep.someoneWaitingCount > 0) {
    observations.push(
      `${data.sweep.someoneWaitingCount} item${data.sweep.someoneWaitingCount === 1 ? "" : "s"} tienen a alguien esperando tu respuesta.`
    );
  }

  const reconciliationNote = buildReconciliationObservation(lastReconciliation);
  if (reconciliationNote) observations.push(reconciliationNote);

  return observations.slice(0, 4);
}

function buildReconciliationObservation(summary: Record<string, unknown> | null | undefined): string | null {
  if (!summary) return null;

  const workItemsUpdated = Number(summary.workItemsUpdated ?? 0);
  const waitingReceived = Number(summary.waitingReceived ?? 0);
  const newItems =
    Number(summary.newActionsDiscovered ?? 0) +
    Number(summary.newWaitingDiscovered ?? 0) +
    Number(summary.newDelegatedDiscovered ?? 0) +
    Number(summary.newCommitmentsDiscovered ?? 0);

  const parts: string[] = [];
  if (newItems > 0) parts.push(`encontro ${newItems} pendiente${newItems === 1 ? "" : "s"} nuevo${newItems === 1 ? "" : "s"} en Gmail`);
  if (workItemsUpdated > 0) parts.push(`actualizo ${workItemsUpdated} item${workItemsUpdated === 1 ? "" : "s"}`);
  if (waitingReceived > 0) parts.push(`detecto respuesta en ${waitingReceived} espera${waitingReceived === 1 ? "" : "s"}`);

  if (parts.length === 0) return null;
  return `La IA ${parts.join(", ")} en la ultima revision.`;
}
