import { titleSimilarity } from "@/lib/gmail/workItemMatch";
import type { CaseRow } from "@/lib/supabase/types";
import type { ExtractedReference } from "./referenceExtraction";

export type CaseMatchTier = "EXACT" | "STRONG" | "PROBABLE" | "AMBIGUOUS" | "NONE";

export interface CaseMatchResult {
  tier: CaseMatchTier;
  /** Un solo candidato para EXACT/STRONG (auto-merge). Varios (o uno de baja confianza) para
   * PROBABLE/AMBIGUOUS (a CASE_MERGE_REVIEW). Vacio para NONE. */
  candidates: CaseRow[];
  reason: string;
}

export interface MatchCaseInput {
  extractedReferences: ExtractedReference[];
  companyId: string | null;
  threadSubjectOrTitle: string;
  /** Fecha del thread nuevo — para el chequeo de "actividad reciente" del tier PROBABLE. */
  occurredAt: string;
}

const STRONG_SIMILARITY_FLOOR = 0.6;
const PROBABLE_SIMILARITY_FLOOR = 0.35;
const AMBIGUOUS_SIMILARITY_FLOOR = 0.15;
const PROBABLE_DATE_WINDOW_DAYS = 30;

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return ms / (1000 * 60 * 60 * 24);
}

/**
 * Matching de Case puro, sin IA (item 49: nada de embeddings — reusa titleSimilarity, el
 * mismo heuristico de superposicion de palabras ya usado para Work Items). Deliberadamente
 * NUNCA usa "mismo company/contacto solo" como señal suficiente para EXACT o STRONG (item 17:
 * un cliente puede tener 5 cotizaciones abiertas a la vez) — company_id siempre viene
 * acompañado de una segunda señal (referencia o similitud de titulo).
 *
 * `openCases` debe venir ya filtrado por el caller a Cases con `current_state !== 'CLOSED'`
 * (un asunto cerrado no se reabre solo — una referencia exacta contra un Case cerrado igual
 * hace match EXACT mas abajo si el caller decide incluirlo, pero por default no se incluyen).
 */
export function matchCaseForThread(input: MatchCaseInput, openCases: CaseRow[]): CaseMatchResult {
  const extractedValues = new Set(input.extractedReferences.map((r) => r.value));
  const extractedTypes = new Set(input.extractedReferences.map((r) => r.type));

  // --- Tier 1: EXACT — referencia identica contra un Case existente ---
  if (extractedValues.size > 0) {
    const exactMatches = openCases.filter((c) => c.reference_value && extractedValues.has(c.reference_value));
    if (exactMatches.length === 1) {
      return { tier: "EXACT", candidates: exactMatches, reason: `Referencia exacta: ${exactMatches[0]!.reference_value}` };
    }
    if (exactMatches.length > 1) {
      return {
        tier: "AMBIGUOUS",
        candidates: exactMatches,
        reason: "Mas de un Case abierto comparte la misma referencia — no se puede elegir uno solo automaticamente",
      };
    }
  }

  const sameCompany = input.companyId ? openCases.filter((c) => c.company_id === input.companyId) : [];

  if (sameCompany.length > 0) {
    const scored = sameCompany.map((c) => ({
      case: c,
      similarity: titleSimilarity(input.threadSubjectOrTitle, c.title),
      sameReferenceType: c.reference_type !== null && extractedTypes.has(c.reference_type),
    }));

    // --- Tier 2: STRONG — misma empresa + (mismo tipo de referencia O titulo muy parecido) ---
    const strong = scored.filter((s) => s.sameReferenceType || s.similarity >= STRONG_SIMILARITY_FLOOR);
    if (strong.length === 1) {
      return {
        tier: "STRONG",
        candidates: [strong[0]!.case],
        reason: strong[0]!.sameReferenceType
          ? "Misma empresa y mismo tipo de referencia"
          : `Misma empresa y titulo muy similar (${strong[0]!.similarity.toFixed(2)})`,
      };
    }
    if (strong.length > 1) {
      return {
        tier: "AMBIGUOUS",
        candidates: strong.map((s) => s.case),
        reason: "Varios Cases de la misma empresa califican como match fuerte — ambiguo, no se auto-mergea",
      };
    }

    // --- Tier 3: PROBABLE — misma empresa + similitud moderada + actividad reciente ---
    const probable = scored.filter(
      (s) =>
        s.similarity >= PROBABLE_SIMILARITY_FLOOR &&
        s.similarity < STRONG_SIMILARITY_FLOOR &&
        daysBetween(s.case.last_activity_at, input.occurredAt) <= PROBABLE_DATE_WINDOW_DAYS
    );
    if (probable.length > 0) {
      return {
        tier: "PROBABLE",
        candidates: probable.map((s) => s.case),
        reason: "Misma empresa, titulo parecido y actividad reciente — posible mismo asunto, requiere confirmacion",
      };
    }

    // --- Tier 4a: AMBIGUOUS por señal debil (misma empresa, algo de superposicion, pero no
    // alcanza el piso de PROBABLE) — no se descarta en silencio, pero tampoco se auto-mergea. ---
    const weak = scored.filter((s) => s.similarity >= AMBIGUOUS_SIMILARITY_FLOOR && s.similarity < PROBABLE_SIMILARITY_FLOOR);
    if (weak.length > 0) {
      return {
        tier: "AMBIGUOUS",
        candidates: weak.map((s) => s.case),
        reason: "Misma empresa con similitud baja de titulo — señal insuficiente para decidir solo",
      };
    }
  }

  return { tier: "NONE", candidates: [], reason: "Sin señal de match — se crea un Case nuevo" };
}
