const MAX_SUMMARY_LENGTH = 200;

/**
 * El modelo a veces no respeta el limite de longitud pedido en el prompt para `summary`
 * (bug demostrado 2026-08-12: el thread "Proyecto TRAFOBOX - Adjudicación confirmada" fallo
 * dos veces en el catch-up porque el modelo devolvio un summary de 237 caracteres). `summary`
 * es metadata secundaria (una linea de presentacion) — a diferencia de next_action/
 * waiting_for_what/rationale/evidence, que son contenido con el que se decide, truncarla
 * nunca pierde informacion accionable. Por eso normalizamos deterministicamente en vez de
 * rechazar: este helper NUNCA lanza error, solo por longitud no vale la pena gastar un
 * reintento de IA ni marcar el thread como fallido.
 */
export function normalizeSummary(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (collapsed.length <= MAX_SUMMARY_LENGTH) return collapsed;

  const truncated = collapsed.slice(0, MAX_SUMMARY_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  // Corta en limite de palabra si no pierde mas de la mitad del texto — para el caso raro de
  // una "palabra" larguisima sin espacios, mejor cortar duro que devolver un summary muy corto.
  if (lastSpace > MAX_SUMMARY_LENGTH * 0.5) {
    return truncated.slice(0, lastSpace).trimEnd();
  }
  return truncated;
}
