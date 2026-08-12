// Tipos escritos a mano, alineados 1:1 con supabase/schema.sql.
// En Etapa 1 no se genera este archivo automaticamente (no hay proyecto Supabase
// disponible en tiempo de build) — si mas adelante corren `supabase gen types typescript`,
// pueden reemplazar este archivo por el generado sin tocar el resto del codigo,
// siempre que mantengan estos mismos nombres de tabla/columna.
//
// El tipo `Database` de abajo NO se usa hoy para parametrizar el cliente de Supabase
// (ver comentario en src/lib/supabase/server.ts sobre por que ese generic colapsa a
// `never` con @supabase/supabase-js 2.11x + TypeScript 5.9). Se deja igual como
// documentacion viva del schema y por si una version futura del SDK resuelve el
// problema — en ese caso, alcanza con volver a pasar `<Database>` en
// createServerClient/createBrowserClient/createClient.

export type WorkItemCategory = "COMERCIAL" | "TECNICO" | "OPERACIONES" | "ADMINISTRATIVO";
export type WorkItemStatus = "OPEN" | "DONE" | "POSTPONED" | "DELEGATED" | "IGNORED";
export type ContactTier = "A" | "B" | "C";
export type AiConfidence = "HIGH" | "MEDIUM" | "LOW";
export type SourceType =
  | "MANUAL"
  | "GMAIL"
  | "WHATSAPP"
  | "CALENDAR"
  | "ODOO"
  | "DRIVE"
  | "SLACK"
  | "OTHER";
export type SourceDirection = "INBOUND" | "OUTBOUND";
export type ReviewItemKind =
  | "NEW_WORK_ITEM"
  | "UPDATE_WORK_ITEM"
  | "POTENTIAL_COMMITMENT"
  | "POSSIBLE_DUPLICATE"
  | "RECEIVED_CHECK";
export type ReviewItemStatus = "PENDING" | "ACCEPTED" | "APPLIED" | "IGNORED";
export type ReviewItemFeedback = "CORRECT" | "WRONG" | "NOT_IMPORTANT";
export type WhatsAppIngestionStatus = "RECEIVED" | "PROCESSED" | "IGNORED" | "ERROR";

export interface CompanyRow {
  id: string;
  name: string;
  notes: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface ContactRow {
  id: string;
  name: string;
  email: string | null;
  phone_e164: string | null;
  company_id: string | null;
  tier: ContactTier;
  is_demo: boolean;
  created_at: string;
}

export interface ContextRow {
  id: string;
  title: string;
  company_id: string | null;
  notes: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface WorkItemRow {
  id: string;
  title: string;
  context_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  category: WorkItemCategory | null;
  status: WorkItemStatus;
  responsible_id: string | null;
  next_action: string | null;
  waiting_for_what: string | null;
  waiting_for_contact_id: string | null;
  due_date: string | null;
  expected_date: string | null;
  committed_date: string | null;
  follow_up_date: string | null;
  postponed_until: string | null;
  blocking: boolean;
  blocking_note: string | null;
  estimated_minutes: 5 | 15 | 30 | 60 | null;
  last_activity_at: string;
  ai_summary: string | null;
  ai_confidence: AiConfidence | null;
  last_message_direction: SourceDirection | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface NoteRow {
  id: string;
  work_item_id: string;
  body: string;
  created_at: string;
}

export interface CorrectionLogRow {
  id: string;
  work_item_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface SourceLinkRow {
  id: string;
  work_item_id: string;
  source_type: SourceType;
  external_id: string | null;
  external_url: string | null;
  raw_excerpt: string | null;
  raw_metadata: Record<string, unknown> | null;
  direction: SourceDirection | null;
  occurred_at: string;
  is_demo: boolean;
  created_at: string;
}

export interface GoogleConnectionRow {
  id: string;
  email: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  scope: string;
  history_id: string | null;
  bootstrap_completed_at: string | null;
  bootstrap_range_days: number | null;
  last_synced_at: string | null;
  last_sync_summary: Record<string, unknown> | null;
  needs_reconnect: boolean;
  last_error: string | null;
  safe_mode: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReviewItemRow {
  id: string;
  kind: ReviewItemKind;
  status: ReviewItemStatus;
  work_item_id: string | null;
  duplicate_candidate_ids: string[] | null;
  proposed_payload: Record<string, unknown>;
  confidence: AiConfidence;
  rationale: string | null;
  evidence: string | null;
  source_type: SourceType;
  external_id: string | null;
  external_message_id: string | null;
  external_url: string | null;
  raw_excerpt: string | null;
  raw_metadata: Record<string, unknown> | null;
  direction: SourceDirection | null;
  occurred_at: string | null;
  feedback: ReviewItemFeedback | null;
  is_demo: boolean;
  created_at: string;
  resolved_at: string | null;
}

export interface WhatsAppIngestionRow {
  id: string;
  provider: string;
  idempotency_key: string;
  batch_id: string | null;
  chat_id: string | null;
  contact_name: string | null;
  message_count: number;
  status: WhatsAppIngestionStatus;
  error_message: string | null;
  review_item_id: string | null;
  is_demo: boolean;
  received_at: string;
  processed_at: string | null;
}

export interface AutomationSettingsRow {
  id: string;
  whatsapp_auto_enabled: boolean;
  min_confidence: string;
  updated_at: string;
}

export type AiActionSourceType = "GMAIL" | "WHATSAPP";
export type AiActionType = "CREATE" | "UPDATE";

export interface AiActionLogRow {
  id: string;
  source_type: AiActionSourceType;
  action: AiActionType;
  work_item_id: string;
  confidence: string;
  relevance: string;
  reasoning: string | null;
  changed_fields: string[];
  before_values: Record<string, unknown>;
  after_values: Record<string, unknown>;
  created_at: string;
  undone_at: string | null;
}

// Tipos "Insert" escritos como object literals planos (sin Partial<Row> & {...}).
// IMPORTANTE: @supabase/supabase-js 2.11x + TypeScript 5.9 resuelven el generic
// `Schema extends GenericSchema ? Schema : never` de SupabaseClient evaluando
// `Tables extends Record<string, GenericTable>` — y ese chequeo de tipo condicional
// falla (silenciosamente cae a `never`, sin error propio) cuando el campo `Insert`
// de una tabla es una INTERSECCION (`Partial<X> & { campo: string }`). Con un object
// literal plano funciona. Confirmado de forma aislada antes de este cambio — si se
// vuelve a introducir un `&` en un tipo Insert, TODOS los .insert()/.update() de la
// app se rompen en silencio (los argumentos se tipan como `never`).
type CompanyInsert = { id?: string; name: string; notes?: string | null; is_demo?: boolean; created_at?: string };
type ContactInsert = {
  id?: string;
  name: string;
  email?: string | null;
  phone_e164?: string | null;
  company_id?: string | null;
  tier?: ContactTier;
  is_demo?: boolean;
  created_at?: string;
};
type ContextInsert = {
  id?: string;
  title: string;
  company_id?: string | null;
  notes?: string | null;
  is_demo?: boolean;
  created_at?: string;
};
type WorkItemInsert = {
  id?: string;
  title: string;
  context_id?: string | null;
  company_id?: string | null;
  contact_id?: string | null;
  category?: WorkItemCategory | null;
  status?: WorkItemStatus;
  responsible_id?: string | null;
  next_action?: string | null;
  waiting_for_what?: string | null;
  waiting_for_contact_id?: string | null;
  due_date?: string | null;
  expected_date?: string | null;
  committed_date?: string | null;
  follow_up_date?: string | null;
  postponed_until?: string | null;
  blocking?: boolean;
  blocking_note?: string | null;
  estimated_minutes?: 5 | 15 | 30 | 60 | null;
  last_activity_at?: string;
  ai_summary?: string | null;
  ai_confidence?: AiConfidence | null;
  last_message_direction?: SourceDirection | null;
  is_demo?: boolean;
  created_at?: string;
  updated_at?: string;
};
type NoteInsert = { id?: string; work_item_id: string; body: string; created_at?: string };
type GoogleConnectionInsert = {
  id?: string;
  email: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  scope: string;
  history_id?: string | null;
  bootstrap_completed_at?: string | null;
  bootstrap_range_days?: number | null;
  last_synced_at?: string | null;
  last_sync_summary?: Record<string, unknown> | null;
  needs_reconnect?: boolean;
  last_error?: string | null;
  safe_mode?: boolean;
  created_at?: string;
};
type ReviewItemInsert = {
  id?: string;
  kind: ReviewItemKind;
  status?: ReviewItemStatus;
  work_item_id?: string | null;
  duplicate_candidate_ids?: string[] | null;
  proposed_payload: Record<string, unknown>;
  confidence: AiConfidence;
  rationale?: string | null;
  evidence?: string | null;
  source_type?: SourceType;
  external_id?: string | null;
  external_message_id?: string | null;
  external_url?: string | null;
  raw_excerpt?: string | null;
  raw_metadata?: Record<string, unknown> | null;
  direction?: SourceDirection | null;
  occurred_at?: string | null;
  feedback?: ReviewItemFeedback | null;
  is_demo?: boolean;
  created_at?: string;
  resolved_at?: string | null;
};
type WhatsAppIngestionInsert = {
  id?: string;
  provider?: string;
  idempotency_key: string;
  batch_id?: string | null;
  chat_id?: string | null;
  contact_name?: string | null;
  message_count?: number;
  status?: WhatsAppIngestionStatus;
  error_message?: string | null;
  review_item_id?: string | null;
  is_demo?: boolean;
  received_at?: string;
  processed_at?: string | null;
};
type AutomationSettingsUpdate = { whatsapp_auto_enabled?: boolean; min_confidence?: string; updated_at?: string };
type AiActionLogInsert = {
  id?: string;
  source_type: AiActionSourceType;
  action: AiActionType;
  work_item_id: string;
  confidence: string;
  relevance: string;
  reasoning?: string | null;
  changed_fields?: string[];
  before_values?: Record<string, unknown>;
  after_values?: Record<string, unknown>;
  created_at?: string;
  undone_at?: string | null;
};
type CorrectionLogInsert = {
  id?: string;
  work_item_id: string;
  field: string;
  old_value?: string | null;
  new_value?: string | null;
  created_at?: string;
};
type SourceLinkInsert = {
  id?: string;
  work_item_id: string;
  source_type: SourceType;
  external_id?: string | null;
  external_url?: string | null;
  raw_excerpt?: string | null;
  raw_metadata?: Record<string, unknown> | null;
  direction?: SourceDirection | null;
  occurred_at?: string;
  is_demo?: boolean;
  created_at?: string;
};

// @supabase/postgrest-js (v2.x) exige que cada tabla tenga `Relationships` y que el
// schema tenga `Views`/`Functions`, aunque esten vacios (ver GenericTable/GenericSchema
// en node_modules/@supabase/postgrest-js/src/types/common/common.ts). Sin esto, TS
// resuelve los argumentos de .insert()/.update() como `never` en toda la app.
export interface Database {
  public: {
    Tables: {
      company: { Row: CompanyRow; Insert: CompanyInsert; Update: Partial<CompanyRow>; Relationships: never[] };
      contact: { Row: ContactRow; Insert: ContactInsert; Update: Partial<ContactRow>; Relationships: never[] };
      context: { Row: ContextRow; Insert: ContextInsert; Update: Partial<ContextRow>; Relationships: never[] };
      work_item: { Row: WorkItemRow; Insert: WorkItemInsert; Update: Partial<WorkItemRow>; Relationships: never[] };
      note: { Row: NoteRow; Insert: NoteInsert; Update: Partial<NoteRow>; Relationships: never[] };
      correction_log: {
        Row: CorrectionLogRow;
        Insert: CorrectionLogInsert;
        Update: Partial<CorrectionLogRow>;
        Relationships: never[];
      };
      source_link: {
        Row: SourceLinkRow;
        Insert: SourceLinkInsert;
        Update: Partial<SourceLinkRow>;
        Relationships: never[];
      };
      google_connection: {
        Row: GoogleConnectionRow;
        Insert: GoogleConnectionInsert;
        Update: Partial<GoogleConnectionRow>;
        Relationships: never[];
      };
      review_item: {
        Row: ReviewItemRow;
        Insert: ReviewItemInsert;
        Update: Partial<ReviewItemRow>;
        Relationships: never[];
      };
      whatsapp_ingestion: {
        Row: WhatsAppIngestionRow;
        Insert: WhatsAppIngestionInsert;
        Update: Partial<WhatsAppIngestionRow>;
        Relationships: never[];
      };
      automation_settings: {
        Row: AutomationSettingsRow;
        Insert: AutomationSettingsUpdate;
        Update: AutomationSettingsUpdate;
        Relationships: never[];
      };
      ai_action_log: {
        Row: AiActionLogRow;
        Insert: AiActionLogInsert;
        Update: Partial<AiActionLogRow>;
        Relationships: never[];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
