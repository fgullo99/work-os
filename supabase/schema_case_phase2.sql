-- Work OS — Pivot a CASE (Fase 2). Migracion aditiva. Correr despues de schema_case.sql.
-- No borra ni modifica work_item/review_item/source_link existentes.

-- ---------- case_source_link: indice por MENSAJE, no por thread ----------
-- La Fase 1 creo un indice unico (case_id, external_id) a nivel THREAD. Para un timeline real
-- (item 24: "13/08 Thomas envio oferta", "15/08 Thomas hizo seguimiento" como eventos
-- SEPARADOS del mismo thread) hace falta un row por MENSAJE, no por thread — se reemplaza el
-- indice por uno sobre (case_id, external_message_id). Seguro corra o no corra ya la Fase 1
-- (DROP...IF EXISTS + CREATE...IF NOT EXISTS).
drop index if exists case_source_link_gmail_thread_idx;
create unique index if not exists case_source_link_gmail_message_idx
  on case_source_link(case_id, external_message_id)
  where source_type = 'GMAIL' and external_message_id is not null;

-- ---------- work_item: FK opcional a case, sin poblar en esta ronda ----------
alter table work_item add column if not exists case_id uuid references "case"(id) on delete set null;
create index if not exists work_item_case_id_idx on work_item(case_id);

-- ---------- review_item: extension para Review de Cases ----------
alter table review_item add column if not exists case_id uuid references "case"(id) on delete cascade;
create index if not exists review_item_case_id_idx on review_item(case_id);

alter type review_item_kind add value if not exists 'CASE_MERGE_REVIEW';
alter type review_item_kind add value if not exists 'CASE_STATE_REVIEW';

-- ---------- case_catchup_state ----------
-- Mismo shape que gmail_catchup_state (mismo motivo: reusar el batching/lock/retry de
-- catchup.ts sin tocar la fila del catch-up viejo, ver src/lib/cases/caseCatchup.ts). Se
-- siembra LEYENDO gmail_catchup_state (nunca escribiendolo).
create table if not exists case_catchup_state (
  id                          uuid primary key default gen_random_uuid(),
  connection_id               uuid not null references google_connection(id) on delete cascade,
  status                      text not null default 'in_progress' check (status in ('in_progress','completed','failed')),
  thread_queue                text[] not null default '{}',
  cursor_index                int not null default 0,
  processed_count             int not null default 0,
  cases_created_count         int not null default 0,
  threads_merged_count        int not null default 0,
  case_merge_review_count     int not null default 0,
  case_state_review_count     int not null default 0,
  no_op_count                 int not null default 0,
  ignored_count               int not null default 0,
  rule_filtered_count         int not null default 0,
  failed_count                int not null default 0,
  failed_threads              jsonb not null default '[]'::jsonb,
  permanently_failed_threads  jsonb not null default '[]'::jsonb,
  worker_locked_at            timestamptz,
  worker_id                   text,
  ai_calls_count              int not null default 0,
  ai_input_tokens             bigint not null default 0,
  ai_output_tokens            bigint not null default 0,
  started_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  completed_at                timestamptz,
  unique(connection_id)
);

alter table case_catchup_state enable row level security;
create policy "authenticated_all" on case_catchup_state
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
