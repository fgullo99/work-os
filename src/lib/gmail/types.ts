import type { SourceDirection, WorkItemCategory } from "@/lib/supabase/types";

export interface NormalizedMessage {
  id: string;
  direction: SourceDirection;
  from: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  subject: string;
  date: string; // ISO
  snippet: string;
  bodyText: string;
  hasListUnsubscribe: boolean;
}

export interface NormalizedThread {
  threadId: string;
  historyId: string | null;
  messages: NormalizedMessage[]; // orden cronologico
  subject: string;
  webUrl: string;
}

/** Shape exacto que arma buildProposedPayload() en applySync.ts y que consume la bandeja
 * Review (tanto para mostrar la card como para aplicarla en src/lib/workItems/reviewItems.ts). */
export interface ReviewProposedPayload {
  title: string;
  next_action: string | null;
  waiting_for_what: string | null;
  waiting_for_person: string | null;
  due_date: string | null;
  expected_date: string | null;
  committed_date: string | null;
  suggested_company: string | null;
  suggested_contact: string | null;
  suggested_context: string | null;
  suggested_category: WorkItemCategory | null;
  blocking: boolean;
  is_delegation: boolean;
  classification: string;
  /** Solo WhatsApp/Zapia: si el usuario ya delego esto en otra persona (ver
   * whatsappSchema.ts). Opcional — Gmail/manual nunca lo llenan. Informativo en el
   * Review Card; no se resuelve a un contact_id al aceptar (ver nota en zapiaPipeline.ts). */
  responsible?: string | null;
}

export interface ExistingWorkItemSummary {
  id: string;
  title: string;
  status: string;
  next_action: string | null;
  waiting_for_what: string | null;
  expected_date: string | null;
  due_date: string | null;
  committed_date: string | null;
}
