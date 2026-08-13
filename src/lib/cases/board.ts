import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaseRow } from "@/lib/supabase/types";
import { computeCasePriority, computeCaseRisk, type CasePriorityResult } from "./casePriority";

type DB = SupabaseClient;

export interface CaseBoardData {
  /** Top 3-5 Cases con mas urgencia (ACTION_ME/BLOCKED principalmente) — mismo criterio que
   * el HOY del Dashboard viejo, ahora sobre Cases (item 22). */
  hoyCases: Array<CaseRow & { priority: CasePriorityResult }>;
  /**
   * Columnas operativas del Kanban — bucketizadas SOLO por current_state, nunca por risk.
   * BLOCKED ya no tiene columna propia aca (era el bug: se etiquetaba "EN RIESGO" pero
   * filtraba por estado, no por risk — ver atRiskCases). Un Case BLOCKED sigue siendo un
   * estado operativo valido, simplemente no hay una columna dedicada para el en esta ronda.
   */
  kanban: {
    actionMe: CaseRow[];
    waitingExternal: CaseRow[];
    delegatedInternal: CaseRow[];
  };
  /**
   * Unica fuente de verdad para "riesgo" — cases.filter(c => computeCaseRisk(c).isAtRisk),
   * independiente de current_state. Un Case AT_RISK sigue apareciendo TAMBIEN en su columna
   * operativa normal (WAITING_EXTERNAL, ACTION_ME, etc.) — esta lista es una vista horizontal
   * aparte, no una columna exclusiva. El KPI "En riesgo" del header usa exactamente
   * atRiskCases.length, nunca un conteo separado, para que nunca puedan desincronizarse.
   */
  atRiskCases: CaseRow[];
  noActionCount: number;
  closedCount: number;
  counts: { hoy: number; enRiesgo: number; esperando: number };
}

/**
 * getCaseBoardData() — lectura pura de DB, NUNCA llama IA (item 37: el Kanban se reanaliza en
 * background via el catch-up, la UI solo lee lo ya calculado). Un solo select sobre "case".
 */
export async function getCaseBoardData(supabase: DB, todayISO: string): Promise<CaseBoardData> {
  const { data, error } = await supabase.from("case").select("*").neq("current_state", "CLOSED");
  if (error) throw error;
  const cases = (data ?? []) as CaseRow[];

  const active = cases.filter((c) => c.current_state !== "NO_ACTION");
  const noActionCount = cases.filter((c) => c.current_state === "NO_ACTION").length;

  const kanban = {
    actionMe: active.filter((c) => c.current_state === "ACTION_ME"),
    waitingExternal: active.filter((c) => c.current_state === "WAITING_EXTERNAL"),
    delegatedInternal: active.filter((c) => c.current_state === "DELEGATED_INTERNAL"),
  };

  // Unica fuente de verdad de riesgo: risk es una dimension independiente de current_state
  // (un Case puede ser WAITING_EXTERNAL + AT_RISK a la vez). computeCaseRisk ya excluye
  // CLOSED/NO_ACTION internamente, asi que filtrar sobre "cases" completo (post CLOSED) es
  // equivalente a filtrar sobre "active" para este proposito.
  const atRiskCases = cases.filter((c) => computeCaseRisk(c, todayISO).isAtRisk).sort((a, b) => compareAtRisk(a, b, todayISO));

  const priorityCandidates = active
    .filter((c) => c.current_state === "ACTION_ME" || c.current_state === "BLOCKED")
    .map((c) => ({ case: c, priority: computeCasePriority(c, todayISO) }));

  const hoyCases = priorityCandidates
    .filter(({ priority }) => priority.bucket === "DO_NOW" || priority.bucket === "TODAY")
    .sort((a, b) => b.priority.score - a.priority.score)
    .slice(0, 5)
    .map(({ case: c, priority }) => ({ ...c, priority }));

  const esperandoCount = kanban.waitingExternal.length;

  return {
    hoyCases,
    kanban,
    atRiskCases,
    noActionCount,
    closedCount: 0, // no se trae por default (filtrado en la query) — ver getCaseBoardCounts si hace falta el numero
    counts: { hoy: hoyCases.length, enRiesgo: atRiskCases.length, esperando: esperandoCount },
  };
}

/**
 * Orden de la seccion EN RIESGO (item pedido explicitamente): 1) deadline vencida, 2) alguien
 * esperando hace rato / bloqueado, 3) fecha mas proxima, 4) antiguedad como ultimo criterio.
 * Comparaciones de fecha por string ISO (YYYY-MM-DD) — el orden lexicografico ya es
 * cronologico, no hace falta parsear a Date.
 */
function compareAtRisk(a: CaseRow, b: CaseRow, todayISO: string): number {
  const tierA = riskSortTier(a, todayISO);
  const tierB = riskSortTier(b, todayISO);
  if (tierA !== tierB) return tierA - tierB;

  switch (tierA) {
    case 1:
      return (a.due_date ?? "").localeCompare(b.due_date ?? "");
    case 2: {
      const da = a.expected_date && a.expected_date < todayISO ? a.expected_date : "9999-99-99";
      const db = b.expected_date && b.expected_date < todayISO ? b.expected_date : "9999-99-99";
      return da.localeCompare(db);
    }
    case 3: {
      const da = nearestFutureDate(a, todayISO) ?? "9999-99-99";
      const db = nearestFutureDate(b, todayISO) ?? "9999-99-99";
      return da.localeCompare(db);
    }
    default:
      return (a.last_activity_at ?? "").localeCompare(b.last_activity_at ?? "");
  }
}

function riskSortTier(c: CaseRow, todayISO: string): 1 | 2 | 3 | 4 {
  if (c.due_date && c.due_date < todayISO) return 1;
  const waitingOverdue = c.current_state === "WAITING_EXTERNAL" && Boolean(c.expected_date) && c.expected_date! < todayISO;
  if (waitingOverdue || c.current_state === "BLOCKED") return 2;
  if (nearestFutureDate(c, todayISO)) return 3;
  return 4;
}

function nearestFutureDate(c: CaseRow, todayISO: string): string | null {
  const candidates = [c.due_date, c.expected_date].filter((d): d is string => d !== null && d >= todayISO);
  if (candidates.length === 0) return null;
  return candidates.sort()[0]!;
}
