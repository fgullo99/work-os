import type {
  AiConfidence,
  CompanyRow,
  ContactRow,
  ContextRow,
  WorkItemCategory,
  WorkItemRow,
} from "@/lib/supabase/types";

/**
 * Work item con sus relaciones resueltas via select anidado de PostgREST.
 * Nota: el Database type en src/lib/supabase/types.ts no modela relaciones,
 * asi que estas formas se castean a mano en queries.ts. Simplificacion valida
 * para V1 (proyecto chico, sin generador de tipos de Supabase conectado).
 */
export interface WorkItemWithRelations extends WorkItemRow {
  company: Pick<CompanyRow, "id" | "name"> | null;
  context: Pick<ContextRow, "id" | "title"> | null;
  contact: Pick<ContactRow, "id" | "name" | "tier"> | null;
  waiting_for_contact: Pick<ContactRow, "id" | "name"> | null;
  responsible: Pick<ContactRow, "id" | "name"> | null;
}

/** Campos que pueden venir sugeridos por IA y por lo tanto son candidatos a correction_log. */
export const CORRECTABLE_FIELDS = [
  "title",
  "next_action",
  "waiting_for_what",
  "due_date",
  "expected_date",
  "committed_date",
  "category",
  "blocking",
] as const;

export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

export interface CreateWorkItemInput {
  title: string;
  context_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  category: WorkItemCategory | null;
  next_action: string | null;
  waiting_for_what: string | null;
  waiting_for_contact_id: string | null;
  due_date: string | null;
  expected_date: string | null;
  committed_date: string | null;
  blocking: boolean;
  blocking_note: string | null;
  estimated_minutes: 5 | 15 | 30 | 60 | null;
  ai_summary: string | null;
  ai_confidence: AiConfidence | null;
  /** Texto original tal cual lo escribio el usuario. Se guarda en source_link.raw_excerpt. */
  rawText: string;
  /**
   * Valores que sugirio la IA ANTES de que el usuario los edite en el preview.
   * Si un campo aparece aca y el valor final es distinto, se registra en correction_log.
   * Ausente (no HIGH/MEDIUM AI involucrada, ej. "crear manualmente") = no se compara nada.
   */
  aiOriginal?: Partial<Record<CorrectableField, string | null>>;
}
