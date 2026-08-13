import type { CaseRow } from "@/lib/supabase/types";
import { addDaysISO, daysBetweenISO } from "@/lib/dates/calendarMath";
import { formatDateShortEs } from "@/lib/format/date";

export type CasePriorityBucket = "DO_NOW" | "TODAY" | "THIS_WEEK" | "CAN_WAIT";

export interface CasePriorityResult {
  score: number;
  bucket: CasePriorityBucket;
  why: string;
}

export interface CaseRiskResult {
  isAtRisk: boolean;
  reasons: string[];
}

/**
 * Version para Case de computePriority (src/lib/engine/priority.ts) — misma filosofia de
 * scoring, pero reimplementada en vez de reusar la funcion de Work Item: Case usa
 * current_state (7 valores) en vez de status (5 valores), y felipe_action_required (que ya
 * viene de la IA, sin heuristica de last_message_direction) reemplaza directamente al factor
 * "alguien espera tu respuesta" — forzar un tipo compartido hubiera significado tocar la
 * firma de priority.ts (usada y testeada en produccion) para un mapeo que no calza 1:1. Item
 * 22 del pedido solo pide reusar el MOTOR (Priority Engine), no necesariamente el codigo
 * exacto — esto es el mismo motor, misma logica, adaptado a la forma real de un Case.
 */
export function computeCasePriority(c: CaseRow, todayISO: string): CasePriorityResult {
  const deadlineDate = c.due_date ?? c.expected_date;
  const deadline = deadlineDate ? urgencyForDate(deadlineDate, todayISO) : { score: 0, label: null as string | null };

  const blockingScore = c.current_state === "BLOCKED" ? 25 : 0;
  const actionScore = c.felipe_action_required ? 30 : 0;
  const riskScore = c.risk === "AT_RISK" ? 20 : 0;

  const score = deadline.score + blockingScore + actionScore + riskScore;
  const bucket = bucketForScore(score);

  const factors: { label: string; weight: number }[] = [];
  if (deadline.label) factors.push({ label: deadline.label, weight: deadline.score });
  if (c.felipe_action_required) factors.push({ label: "accion tuya pendiente", weight: 30 });
  if (c.current_state === "BLOCKED") factors.push({ label: "bloqueado", weight: 25 });
  if (c.risk === "AT_RISK") factors.push({ label: "marcado en riesgo", weight: 20 });
  factors.sort((a, b) => b.weight - a.weight);
  const why = factors.length === 0 ? "Sin urgencia detectada." : capitalize(factors.slice(0, 2).map((f) => f.label).join(" + ")) + ".";

  return { score, bucket, why };
}

/** Version para Case de computeRisk (src/lib/engine/risk.ts) — mismas reglas (OVERDUE,
 * WAITING_OVERDUE, amplificado por BLOCKED), mas el propio juicio de riesgo de la IA
 * (case.risk) como señal adicional. CLOSED/NO_ACTION nunca estan en riesgo (asunto ya
 * resuelto o sin nada pendiente de nadie). */
export function computeCaseRisk(c: CaseRow, todayISO: string): CaseRiskResult {
  if (c.current_state === "CLOSED" || c.current_state === "NO_ACTION") {
    return { isAtRisk: false, reasons: [] };
  }

  const reasons: string[] = [];

  if (c.due_date && c.due_date < todayISO) {
    reasons.push(`Vencido desde ${formatDateShortEs(c.due_date)}`);
  }

  if (c.current_state === "WAITING_EXTERNAL" && c.expected_date && c.expected_date < todayISO) {
    const days = daysBetweenISO(c.expected_date, todayISO);
    reasons.push(`Esperando hace ${days} dia${days === 1 ? "" : "s"} de atraso`);
  }

  if (reasons.length > 0 && c.current_state === "BLOCKED") {
    reasons.push("Bloqueado");
  }

  if (c.risk === "AT_RISK" && reasons.length === 0) {
    reasons.push("Marcado en riesgo por la IA");
  }

  return { isAtRisk: reasons.length > 0 || c.risk === "AT_RISK", reasons };
}

function urgencyForDate(dateISO: string, todayISO: string): { score: number; label: string | null } {
  if (dateISO < todayISO) return { score: 100, label: "Vencido" };
  if (dateISO === todayISO) return { score: 80, label: "Vence hoy" };
  if (dateISO === addDaysISO(todayISO, 1)) return { score: 50, label: "Vence manana" };
  if (dateISO <= addDaysISO(todayISO, 7)) return { score: 20, label: "Vence esta semana" };
  return { score: 0, label: null };
}

function bucketForScore(score: number): CasePriorityBucket {
  if (score >= 80) return "DO_NOW";
  if (score >= 40) return "TODAY";
  if (score >= 15) return "THIS_WEEK";
  return "CAN_WAIT";
}

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}
