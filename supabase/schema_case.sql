-- Work OS — Pivot a CASE (Fase 1). Migracion aditiva.
-- No borra ni modifica work_item/review_item/source_link existentes — el pipeline de Work
-- Item sigue funcionando exactamente igual. Esta es la capa nueva en paralelo.
--
-- Fase 1 solo crea "case" y "case_source_link" — lo minimo para probar el AI Case Analyzer
-- de punta a punta (referencia + matching + analisis). case_catchup_state y los FKs de
-- work_item/review_item quedan para Fase 2, cuando se construya el orquestador real.

create type case_current_state as enum (
  'ACTION_ME', 'WAITING_EXTERNAL', 'DELEGATED_INTERNAL', 'BLOCKED', 'NO_ACTION', 'CLOSED', 'REVIEW'
);
create type case_current_owner as enum ('FELIPE', 'TEAM', 'EXTERNAL', 'NONE', 'UNKNOWN');
create type case_risk_level as enum ('NORMAL', 'AT_RISK');

create table if not exists "case" (
  id                     uuid primary key default gen_random_uuid(),
  title                  text not null,
  company_id             uuid references company(id) on delete set null,
  contact_id             uuid references contact(id) on delete set null,
  context_id             uuid references context(id) on delete set null,

  -- Texto libre, no enum: agregar un tipo de referencia nuevo (item 14, "mantener
  -- extensible") no debe requerir un ALTER TYPE. Ej: QUOTE, PURCHASE_ORDER, RFQ, PROJECT.
  reference_type         text,
  -- Normalizado (mayusculas, sin espacios extra) en src/lib/cases/referenceExtraction.ts.
  reference_value        text,

  current_state          case_current_state not null default 'REVIEW',
  current_owner          case_current_owner not null default 'UNKNOWN',
  felipe_action_required boolean not null default false,

  next_action            text,
  waiting_for            text,
  -- Nombre libre del interno de TMC responsable (Thomas, Carolina...) — no FK a contact,
  -- que es para contactos externos (clientes/proveedores).
  responsible            text,

  due_date               date,
  expected_date          date,

  risk                   case_risk_level not null default 'NORMAL',
  confidence             ai_confidence,
  ai_summary             text,
  last_meaningful_event  text,

  last_activity_at       timestamptz not null default now(),

  -- Telemetria de costo (item 38) — mismo patron que gmail_catchup_state.
  ai_calls_count         int not null default 0,
  ai_input_tokens        bigint not null default 0,
  ai_output_tokens       bigint not null default 0,

  is_demo                boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists case_current_state_idx on "case"(current_state);
create index if not exists case_company_idx on "case"(company_id);
create index if not exists case_reference_value_idx on "case"(reference_value);
create index if not exists case_last_activity_idx on "case"(last_activity_at desc);

create trigger case_set_updated_at
  before update on "case"
  for each row execute function set_updated_at();

-- Mirror de source_link, pero FK a case_id en vez de work_item_id — tabla nueva en vez de
-- agregar case_id nullable a source_link, para que el pipeline de Work Item existente quede
-- en cero riesgo de regresion.
create table if not exists case_source_link (
  id                   uuid primary key default gen_random_uuid(),
  case_id              uuid not null references "case"(id) on delete cascade,
  source_type          source_type not null,
  external_id          text,          -- Gmail: threadId
  external_message_id  text,          -- Gmail: id del mensaje puntual que genero este evento
  external_url         text,
  raw_excerpt          text,
  raw_metadata         jsonb,
  direction            source_direction,
  -- Etiqueta corta, legible, generada DETERMINISTICAMENTE al ingerir (ver
  -- src/lib/cases/eventLabel.ts) — ej. "Email entrante de cliente@x.com". Nunca la escribe
  -- la IA (evita gastar una llamada por evento); el resumen "inteligente" vive en
  -- case.last_meaningful_event / case.ai_summary, no por-evento.
  event_label          text,
  occurred_at          timestamptz not null default now(),
  is_demo              boolean not null default false,
  created_at           timestamptz not null default now()
);

create index if not exists case_source_link_case_idx on case_source_link(case_id);
create index if not exists case_source_link_external_id_idx on case_source_link(external_id);
-- Idempotencia: reprocesar el mismo thread de Gmail para el mismo Case nunca duplica.
create unique index if not exists case_source_link_gmail_thread_idx
  on case_source_link(case_id, external_id) where source_type = 'GMAIL';

alter table "case" enable row level security;
alter table case_source_link enable row level security;

create policy "authenticated_all" on "case"
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on case_source_link
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
