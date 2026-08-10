import type { NormalizedThread } from "./types";

export interface RuleFilterResult {
  skip: boolean;
  reason: string | null;
}

/**
 * Filtro determinista, barato, corre ANTES del LLM. Reglas del spec de producto:
 * - List-Unsubscribe, "bulk", newsletters, marketing/promociones -> señal de ruido.
 * - Cc NUNCA implica descarte automatico.
 * - "noreply"/"no-reply" es SOLO una señal, nunca una regla absoluta — un remitente
 *   no-reply puede traer informacion operativa real (portal de cliente, orden de compra,
 *   logistica). Por eso NO hay ningun chequeo de "from contains noreply" aca.
 *
 * La unica señal que se usa para descartar automaticamente es una combinacion fuerte:
 * TODOS los mensajes del thread traen List-Unsubscribe Y no hay ninguna actividad propia
 * (OUTBOUND) en el thread — eso es casi siempre un newsletter/lista al que el usuario
 * nunca respondio, nunca una conversacion real.
 */
export function applyRuleFilter(thread: NormalizedThread): RuleFilterResult {
  if (thread.messages.length === 0) {
    return { skip: true, reason: "Thread sin mensajes" };
  }

  const allHaveListUnsubscribe = thread.messages.every((m) => m.hasListUnsubscribe);
  const hasOutboundActivity = thread.messages.some((m) => m.direction === "OUTBOUND");

  if (allHaveListUnsubscribe && !hasOutboundActivity) {
    return {
      skip: true,
      reason: "List-Unsubscribe en todos los mensajes y sin actividad propia (bulk/newsletter)",
    };
  }

  return { skip: false, reason: null };
}
