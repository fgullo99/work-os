import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaseRow } from "@/lib/supabase/types";
import { computeCasePriority, computeCaseRisk, type CasePriorityResult } from "./casePriority";

type DB = SupabaseClient;

export interface CaseBoardData {
  /** Top 3-5 Cases con mas urgencia (ACTION_ME/BLOCKED principalmente) — mismo criterio que
   * el HOY del Dashboard viejo, ahora sobre Cases (item 22). */
  hoyCases: Array<CaseRow & { priority: CasePriorityResult }>;
  kanban: {
    actionMe: CaseRow[];
    waitingExternal: CaseRow[];
    delegatedInternal: CaseRow[];
    blocked: CaseRow[];
  };
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
    blocked: active.filter((c) => c.current_state === "BLOCKED"),
  };

  const priorityCandidates = active
    .filter((c) => c.current_state === "ACTION_ME" || c.current_state === "BLOCKED")
    .map((c) => ({ case: c, priority: computeCasePriority(c, todayISO) }));

  const hoyCases = priorityCandidates
    .filter(({ priority }) => priority.bucket === "DO_NOW" || priority.bucket === "TODAY")
    .sort((a, b) => b.priority.score - a.priority.score)
    .slice(0, 5)
    .map(({ case: c, priority }) => ({ ...c, priority }));

  const enRiesgoCount = active.filter((c) => computeCaseRisk(c, todayISO).isAtRisk).length;
  const esperandoCount = kanban.waitingExternal.length;

  return {
    hoyCases,
    kanban,
    noActionCount,
    closedCount: 0, // no se trae por default (filtrado en la query) — ver getCaseBoardCounts si hace falta el numero
    counts: { hoy: hoyCases.length, enRiesgo: enRiesgoCount, esperando: esperandoCount },
  };
}
