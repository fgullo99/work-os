import { addDays, format, lastDayOfMonth, parseISO } from "date-fns";

/**
 * Resuelve una frase de fecha en espanol ("miercoles", "manana", "la semana que viene", ...)
 * a una fecha calendario concreta (YYYY-MM-DD), a partir de una fecha de referencia ("hoy").
 *
 * DECISION DE DISENO: el AI Normalizer NO calcula fechas. Le pedimos que extraiga la frase
 * de fecha tal cual aparece en el texto (ej. "miercoles", "antes del viernes") y esta funcion
 * puramente determinista hace la aritmetica. Los LLM son notoriamente poco confiables haciendo
 * "que dia es el proximo miercoles" - delegarlo a codigo lo hace testeable y 100% reproducible.
 *
 * Si la frase no se reconoce, devuelve null (el usuario completa la fecha a mano en el preview).
 */
export function resolveDatePhrase(phraseRaw: string | null | undefined, referenceDateISO: string): string | null {
  if (!phraseRaw) return null;

  const reference = parseISO(referenceDateISO);
  const referenceDow = reference.getDay(); // 0=domingo .. 6=sabado

  let phrase = stripAccents(phraseRaw.toLowerCase().trim());
  phrase = stripFillerPrefixes(phrase);

  if (!phrase) return null;

  // --- casos directos ---
  if (phrase === "hoy") return referenceDateISO;
  if (phrase === "manana") return toISO(addDays(reference, 1));
  if (phrase === "pasado manana") return toISO(addDays(reference, 2));

  if (phrase === "fin de mes" || phrase === "fin de este mes") {
    return toISO(lastDayOfMonth(reference));
  }

  if (phrase === "fin de semana") {
    const diff = (6 - referenceDow + 7) % 7 || 7; // proximo sabado
    return toISO(addDays(reference, diff));
  }

  // stripFillerPrefixes ya saco "la"/"esta"/"proximo(a)" adelante y "que viene" atras,
  // asi que "la semana que viene", "semana que viene", "proxima semana" y "esta semana"
  // llegan todos reducidos a "semana" aca. Es una simplificacion deliberada: V1 no
  // distingue "esta semana" de "la semana que viene" (queda documentado como limitacion).
  if (phrase === "semana") {
    const diffToNextMonday = ((1 - referenceDow + 7) % 7) || 7;
    return toISO(addDays(reference, diffToNextMonday));
  }

  // --- dia de la semana ("miercoles", "el miercoles que viene", "proximo lunes") ---
  const weekdayMatch = matchWeekday(phrase);
  if (weekdayMatch !== null) {
    let diff = (weekdayMatch - referenceDow + 7) % 7;
    if (diff === 0) diff = 7; // "el miercoles" dicho un miercoles se refiere al que viene, no a hoy
    return toISO(addDays(reference, diff));
  }

  // --- fecha explicita: "12 de agosto", "12/08", "12-08-2026" ---
  const explicit = matchExplicitDate(phrase, reference);
  if (explicit) return explicit;

  return null;
}

function toISO(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

// Unicode combining diacritical marks block: U+0300..U+036F. Filtramos por code point
// en vez de usar una regex con caracteres acentuados literales en el codigo fuente.
function stripAccents(value: string): string {
  return Array.from(value.normalize("NFD"))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x0300 || code > 0x036f;
    })
    .join("");
}

function stripFillerPrefixes(phrase: string): string {
  let result = phrase;
  const prefixes = [
    /^antes del?\s+/,
    /^antes de\s+/,
    /^para el\s+/,
    /^para la\s+/,
    /^para\s+/,
    /^el\s+/,
    /^la\s+/,
    /^este\s+/,
    /^esta\s+/,
    /^proximo\s+/,
    /^proxima\s+/,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of prefixes) {
      const next = result.replace(re, "");
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
  }
  return result
    .replace(/\s+que viene$/, "")
    .replace(/\s+proxima$/, "")
    .replace(/\s+proximo$/, "")
    .trim();
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

function matchWeekday(phrase: string): number | null {
  const token = phrase.split(/\s+/)[0];
  if (token && token in WEEKDAYS) return WEEKDAYS[token]!;
  return null;
}

const MONTHS: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

function matchExplicitDate(phrase: string, reference: Date): string | null {
  // "12 de agosto" / "12 de agosto de 2026"
  const longForm = phrase.match(/^(\d{1,2}) de ([a-z]+)(?: de (\d{4}))?$/);
  if (longForm) {
    const day = Number(longForm[1]);
    const monthName = longForm[2] as string;
    const month = MONTHS[monthName];
    if (month === undefined) return null;
    const year = longForm[3] ? Number(longForm[3]) : reference.getFullYear();
    let candidate = new Date(year, month, day);
    if (!longForm[3] && candidate < stripTime(reference)) {
      candidate = new Date(year + 1, month, day);
    }
    return toISO(candidate);
  }

  // "12/08" / "12/08/2026" / "12-08-2026"
  const numeric = phrase.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    if (month < 0 || month > 11) return null;
    let year = numeric[3] ? Number(numeric[3]) : reference.getFullYear();
    if (year < 100) year += 2000;
    let candidate = new Date(year, month, day);
    if (!numeric[3] && candidate < stripTime(reference)) {
      candidate = new Date(year + 1, month, day);
    }
    return toISO(candidate);
  }

  return null;
}

function stripTime(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
