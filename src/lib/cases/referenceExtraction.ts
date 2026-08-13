import type { NormalizedThread } from "@/lib/gmail/types";

export interface ExtractedReference {
  type: string;
  value: string;
  matchedText: string;
}

function defaultBuildValue(match: RegExpMatchArray): string {
  return match[0].toUpperCase().replace(/\s+/g, "");
}

interface ReferencePattern {
  type: string;
  regex: RegExp;
  /** Por defecto usa el match completo normalizado (mayusculas, sin espacios). Los patrones
   * que tienen separadores variables entre el prefijo y el numero (ej. "OC N° 40991" vs
   * "OC-40991") arman el valor a partir de los grupos capturados en vez del match crudo, asi
   * las dos formas de escribir la misma referencia normalizan al mismo valor. */
  buildValue?: (match: RegExpMatchArray) => string;
}

/**
 * Orden de prioridad = orden de especificidad, no de aparicion en el texto. Extensible a
 * proposito (item 14 del pedido): agregar un patron nuevo es agregar una entrada a esta
 * lista, nunca tocar la logica de extraccion de mas abajo.
 */
const REFERENCE_PATTERNS: ReferencePattern[] = [
  // Cotizaciones tipo Odoo: S00103, S00057, S00296.
  { type: "QUOTE", regex: /\bS\d{4,6}\b/gi },
  // OC 40991, OC N° 40991, PO-40991, PO 40991.
  {
    type: "PURCHASE_ORDER",
    regex: /\b(OC|PO)\b[^\d\n]{0,10}(\d{3,7})\b/gi,
    buildValue: (m) => `${m[1]!.toUpperCase()}${m[2]}`,
  },
  // RFQ-123, RFQ 123.
  {
    type: "RFQ",
    regex: /\bRFQ[-\s]?(\d{2,8})\b/gi,
    buildValue: (m) => `RFQ${m[1]}`,
  },
  // Codigos de proyecto tipo MDZ5256.
  { type: "PROJECT", regex: /\bMDZ\d{3,6}\b/gi },
  // Pedidos tipo PI-26/136.
  { type: "PROJECT", regex: /\bPI[-\s]?\d{1,3}\/\d{2,4}\b/gi },
  // Ordenes de venta tipo SO-12345.
  {
    type: "SALES_ORDER",
    regex: /\bSO[-\s]?(\d{3,7})\b/gi,
    buildValue: (m) => `SO${m[1]}`,
  },
];

/**
 * Corre TODOS los patrones sobre el texto (subject + cuerpo de mensajes — nunca solo el
 * subject, un thread puede cambiar de asunto y la referencia real aparecer solo en el
 * cuerpo). Devuelve todas las coincidencias, deduplicadas por (type, value), en el orden de
 * prioridad de REFERENCE_PATTERNS — el caller (caseMatch.ts) usa la primera como "la"
 * referencia principal del thread si hace falta elegir una sola.
 */
export function extractReferences(text: string): ExtractedReference[] {
  const seen = new Set<string>();
  const results: ExtractedReference[] = [];

  for (const pattern of REFERENCE_PATTERNS) {
    const regex = new RegExp(pattern.regex);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const value = (pattern.buildValue ?? defaultBuildValue)(match);
      const key = `${pattern.type}:${value}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ type: pattern.type, value, matchedText: match[0] });
      }
      // Los patrones sin flag global-safe loop protection: RegExp con "g" ya avanza
      // lastIndex solo en cada exec(), no hace falta incrementar a mano.
      if (match[0].length === 0) regex.lastIndex += 1; // guarda contra loop infinito en match vacio
    }
  }

  return results;
}

export function extractReferencesFromThread(thread: NormalizedThread): ExtractedReference[] {
  const text = [thread.subject, ...thread.messages.map((m) => m.bodyText)].join("\n");
  return extractReferences(text);
}
