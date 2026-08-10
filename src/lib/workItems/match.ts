/** Busca la mejor coincidencia existente por nombre/titulo (case-insensitive, substring). Funcion pura, usable en cliente y servidor. */
export function findBestMatch<T extends { id: string; name?: string; title?: string }>(
  items: T[],
  query: string | null
): T | null {
  if (!query) return null;
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const exact = items.find((i) => (i.name ?? i.title ?? "").toLowerCase() === q);
  if (exact) return exact;
  const partial = items.find((i) => (i.name ?? i.title ?? "").toLowerCase().includes(q));
  return partial ?? null;
}
