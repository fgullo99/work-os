const WEEKDAY_LABELS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const MONTH_LABELS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/** "2026-08-12" -> "mie 12 ago" */
export function formatDateShortEs(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return `${WEEKDAY_LABELS[d.getDay()]} ${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
}

/** "2026-08-12" -> "miercoles 12 de agosto" */
const WEEKDAY_LONG = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const MONTH_LONG = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function formatDateLongEs(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return `${WEEKDAY_LONG[d.getDay()]} ${d.getDate()} de ${MONTH_LONG[d.getMonth()]}`;
}

/** Timestamp (con hora) ISO -> "hace 12 min" / "hace 3 h" / "hace 2 dias" / fecha corta si es mas viejo. */
export function formatRelativeEs(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "recien";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} dia${days === 1 ? "" : "s"}`;
  return formatDateShortEs(iso.slice(0, 10));
}
