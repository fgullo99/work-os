-- Work OS — AI Work Manager: reconciliacion + descubrimiento de threads no linkeados.
-- Migracion aditiva. Correr despues de schema_automation.sql.

-- Feedback loop (seccion 30 del pedido): agrega PERSONAL al enum ya existente.
alter type review_item_feedback add value if not exists 'PERSONAL';

-- Existing Item Reconciliation: cuando fue la ultima vez que se re-examino este Work Item
-- contra el estado actual de su thread de Gmail, y con que fingerprint (historyId) — para no
-- gastar IA de nuevo si el thread no cambio desde entonces.
alter table work_item add column if not exists last_reconciled_at timestamptz;
alter table work_item add column if not exists last_reconciled_thread_version text;

create index if not exists work_item_last_reconciled_at_idx on work_item (last_reconciled_at);

-- Unlinked Thread Discovery: registro minimo (sin contenido del mail) de threads de Gmail ya
-- evaluados que NO terminaron linkeados a un Work Item — para no volver a analizarlos con IA
-- en cada pasada si Gmail no cambio nada.
create table if not exists gmail_thread_reconciliation (
  thread_id       text primary key,
  last_checked_at timestamptz not null default now(),
  thread_version  text,
  outcome         text not null,
  work_item_id    uuid references work_item(id) on delete set null
);

create index if not exists gmail_thread_reconciliation_last_checked_idx on gmail_thread_reconciliation (last_checked_at);

alter table gmail_thread_reconciliation enable row level security;
create policy "authenticated_all" on gmail_thread_reconciliation for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Morning Brief: ultimo resultado de runReconciliationSweep, para que el Dashboard pueda
-- mostrarlo sin llamar a la IA en el render (mismo patron que last_sync_summary).
alter table google_connection add column if not exists last_reconciliation_summary jsonb;
alter table google_connection add column if not exists last_reconciled_at timestamptz;
