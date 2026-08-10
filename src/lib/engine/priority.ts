import type { ContactTier, WorkItemRow } from "@/lib/supabase/types";
import { addDaysISO, daysBetweenISO } from "@/lib/dates/calendarMath";

export type PriorityBucket = "DO_NOW" | "TODAY" | "THIS_WEEK" | "CAN_WAIT";

export interface PriorityResult {
  score: number;
  bucket: PriorityBucket;
  why: string;
}

export interface PriorityContext {
  todayISO: string;
  /** Tier del contacto asociado al Work Item (contact_id). Default "B" si no hay contacto. */
  contactTier: ContactTier | null;
}

/**
 * Priority Engine V1 (Work OS MVP Spec, seccion 10; someone_waiting agregado en Etapa 2
 * seccion 16 ahora que Gmail existe y sabemos la direccion del ultimo mensaje del thread).
 *
 * score = deadline_urgency + contact_tier + blocking + waiting_overdue + someone_waiting
 * Determinista. Nunca usa IA para explicar la prioridad (why se arma por plantilla). El
 * factor someone_waiting no necesita LLM adicional: alcanza con last_message_direction
 * (que ya guarda el pipeline de sync de Gmail) + next_action pendiente.
 */
export function computePriority(item: WorkItemRow, ctx: PriorityContext): PriorityResult {
  const { todayISO } = ctx;

  const deadlineDate = item.due_date ?? item.committed_date ?? null;
  const deadline = deadlineDate ? urgencyForDate(deadlineDate, todayISO) : { score: 0, label: null as string | null };

  const tier = ctx.contactTier ?? "B";
  const tierScore = tier === "A" ? 20 : tier === "B" ? 10 : 0;

  const blockingScore = item.blocking ? 25 : 0;

  let waitingOverdueDays = 0;
  let waitingOverdueScore = 0;
  if (item.waiting_for_what && item.expected_date && item.expected_date < todayISO) {
    waitingOverdueDays = daysBetweenISO(item.expected_date, todayISO);
    waitingOverdueScore = 30;
  }

  // someone_waiting: el ultimo mensaje relevante del thread fue INBOUND y todavia tenemos
  // una accion propia pendiente -> alguien esta esperando nuestra respuesta.
  const someoneWaiting = Boolean(item.next_action) && item.last_message_direction === "INBOUND";
  const someoneWaitingScore = someoneWaiting ? 30 : 0;

  const score = deadline.score + tierScore + blockingScore + waitingOverdueScore + someoneWaitingScore;
  const bucket = bucketForScore(score);

  const why = buildWhy({
    deadlineLabel: deadline.label,
    tier,
    tierScore,
    blocking: item.blocking,
    blockingNote: item.blocking_note,
    waitingOverdueDays,
    someoneWaiting,
  });

  return { score, bucket, why };
}

function urgencyForDate(dateISO: string, todayISO: string): { score: number; label: string | null } {
  if (dateISO < todayISO) return { score: 100, label: "Vencido" };
  if (dateISO === todayISO) return { score: 80, label: "Vence hoy" };
  if (dateISO === addDaysISO(todayISO, 1)) return { score: 50, label: "Vence manana" };
  if (dateISO <= addDaysISO(todayISO, 7)) return { score: 20, label: "Vence esta semana" };
  return { score: 0, label: null };
}

function bucketForScore(score: number): PriorityBucket {
  if (score >= 80) return "DO_NOW";
  if (score >= 40) return "TODAY";
  if (score >= 15) return "THIS_WEEK";
  return "CAN_WAIT";
}

function buildWhy(params: {
  deadlineLabel: string | null;
  tier: ContactTier;
  tierScore: number;
  blocking: boolean;
  blockingNote: string | null;
  waitingOverdueDays: number;
  someoneWaiting: boolean;
}): string {
  const factors: { label: string; weight: number }[] = [];

  if (params.deadlineLabel) {
    const weight = params.deadlineLabel === "Vencido" ? 100 : params.deadlineLabel === "Vence hoy" ? 80 : params.deadlineLabel === "Vence manana" ? 50 : 20;
    factors.push({ label: params.deadlineLabel, weight });
  }

  if (params.waitingOverdueDays > 0) {
    factors.push({
      label: `${params.waitingOverdueDays} dia${params.waitingOverdueDays === 1 ? "" : "s"} atrasado`,
      weight: 30,
    });
  }

  if (params.someoneWaiting) {
    factors.push({ label: "respuesta pendiente de tu parte", weight: 30 });
  }

  if (params.tierScore > 0) {
    factors.push({ label: `Cliente Tier ${params.tier}`, weight: params.tierScore });
  }

  if (params.blocking) {
    factors.push({ label: params.blockingNote ? `bloquea ${params.blockingNote}` : "bloquea otra actividad", weight: 25 });
  }

  if (factors.length === 0) return "Sin urgencia detectada.";

  factors.sort((a, b) => b.weight - a.weight);
  const top = factors.slice(0, 2).map((f) => f.label);
  return capitalize(top.join(" + ")) + ".";
}

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}
