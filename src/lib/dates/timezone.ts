export const WORK_OS_TIMEZONE = "America/Argentina/Buenos_Aires";

/**
 * Devuelve la fecha de "hoy" en la zona horaria de Argentina como YYYY-MM-DD.
 * Nunca usar `new Date().toISOString()` para esto: da la fecha en UTC, que
 * puede estar un dia adelantada/atrasada respecto al dia calendario real en AR.
 */
export function todayInTimezone(reference: Date = new Date(), timeZone: string = WORK_OS_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(reference);
}
