-- Work OS — Gmail catch-up acotado, resumible y observable. Migracion aditiva.
-- Correr despues de schema_reconciliation.sql.

-- Una fila por conexion: el catch-up de un backlog grande de Gmail se hace en lotes (ver
-- src/lib/gmail/catchup.ts), nunca en una sola corrida sin checkpoint. thread_queue guarda
-- el orden fijo de threads a procesar (capturado UNA vez al arrancar, para que sea
-- deterministico), cursor_index es hasta donde se llego — si el proceso muere a mitad de un
-- lote, la proxima corrida sigue desde cursor_index, nunca desde cero.
create table if not exists gmail_catchup_state (
  id                 uuid primary key default gen_random_uuid(),
  connection_id      uuid not null references google_connection(id) on delete cascade,
  status             text not null default 'in_progress', -- in_progress | completed | failed
  thread_queue       jsonb not null default '[]'::jsonb,
  cursor_index       int not null default 0,
  processed_count    int not null default 0,
  auto_created_count int not null default 0,
  auto_updated_count int not null default 0,
  no_op_count        int not null default 0,
  review_count       int not null default 0,
  ignored_count      int not null default 0,
  rule_filtered_count int not null default 0,
  failed_count       int not null default 0,
  -- historyId capturado al ARRANCAR el catch-up — se convierte en el cursor incremental
  -- normal (google_connection.history_id) recien cuando el catch-up termina, para no
  -- perderse actividad de Gmail que llego mientras el catch-up estaba corriendo.
  target_history_id  text,
  started_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz
);

create unique index if not exists gmail_catchup_state_connection_idx on gmail_catchup_state (connection_id);

alter table gmail_catchup_state enable row level security;
create policy "authenticated_all" on gmail_catchup_state for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
