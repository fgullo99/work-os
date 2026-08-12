import { describe, expect, it } from "vitest";
import { buildAssistantObservations } from "./summary";
import type { DashboardData } from "@/lib/workItems/queries";
import type { ReviewItemRow } from "@/lib/supabase/types";

function baseData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    todayItems: [],
    atRiskItems: [],
    waitingForItems: [],
    counts: { today: 0, atRisk: 0, waiting: 0 },
    sweep: { staleItems: [], someoneWaitingCount: 0 },
    ...overrides,
  } as DashboardData;
}

describe("buildAssistantObservations", () => {
  it("sin nada pendiente, solo dice que no hay prioridades urgentes", () => {
    const observations = buildAssistantObservations(baseData(), []);
    expect(observations).toEqual(["No tenes prioridades urgentes en este momento."]);
  });

  it("incluye la prioridad mas alta, at risk y review cuando existen", () => {
    const data = baseData({
      todayItems: [{ title: "Cotizar 13.2kV" }] as unknown as DashboardData["todayItems"],
      atRiskItems: [{}] as unknown as DashboardData["atRiskItems"],
    });
    const reviewItems = [{}] as unknown as ReviewItemRow[];
    const observations = buildAssistantObservations(data, reviewItems);
    expect(observations[0]).toBe('Tu prioridad mas alta ahora es: "Cotizar 13.2kV".');
    expect(observations).toContain("1 item en riesgo requieren atencion.");
    expect(observations).toContain("1 sugerencia esperando tu revision.");
  });

  it("incluye items stale y someone_waiting del sweep", () => {
    const data = baseData({
      sweep: {
        staleItems: [{ id: "a", title: "Pedido viejo", daysSinceActivity: 20 }],
        someoneWaitingCount: 2,
      },
    });
    const observations = buildAssistantObservations(data, []);
    expect(observations).toContain('1 item sin actividad hace 15+ dias — el mas viejo: "Pedido viejo" (20 dias).');
    expect(observations).toContain("2 items tienen a alguien esperando tu respuesta.");
  });

  it("sin resultado de reconciliacion (null), no agrega esa observacion", () => {
    const observations = buildAssistantObservations(baseData(), [], null);
    expect(observations.join(" ")).not.toContain("La IA");
  });

  it("con resultado de reconciliacion, resume lo que la IA encontro/actualizo/detecto", () => {
    const observations = buildAssistantObservations(baseData(), [], {
      newActionsDiscovered: 2,
      newWaitingDiscovered: 1,
      newDelegatedDiscovered: 0,
      newCommitmentsDiscovered: 0,
      workItemsUpdated: 3,
      waitingReceived: 1,
    });
    const note = observations.find((o) => o.startsWith("La IA"));
    expect(note).toBe("La IA encontro 3 pendientes nuevos en Gmail, actualizo 3 items, detecto respuesta en 1 espera en la ultima revision.");
  });

  it("nunca devuelve mas de 4 observaciones", () => {
    const data = baseData({
      todayItems: [{ title: "X" }] as unknown as DashboardData["todayItems"],
      atRiskItems: [{}] as unknown as DashboardData["atRiskItems"],
      sweep: {
        staleItems: [{ id: "a", title: "Y", daysSinceActivity: 20 }],
        someoneWaitingCount: 1,
      },
    });
    const reviewItems = [{}] as unknown as ReviewItemRow[];
    const observations = buildAssistantObservations(data, reviewItems, { workItemsUpdated: 1 });
    expect(observations.length).toBeLessThanOrEqual(4);
  });
});
