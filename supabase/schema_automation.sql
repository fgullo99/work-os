-- Work OS — AI Autonomy. Migracion aditiva.
-- Correr DESPUES de schema.sql, schema_gmail.sql, schema_gmail_security.sql, schema_v1.sql,
-- schema_zapia.sql y schema_zapia_rls.sql.
--
-- automation_settings: fila unica de configuracion para WhatsApp. Gmail NO tiene su propio
-- campo aca a proposito — google_connection.safe_mode sigue siendo la UNICA fuente de verdad
-- para "AI Automation" de Gmail, para no tener dos booleanos que puedan desincronizarse.
-- whatsapp_auto_enabled arranca en false: el pipeline de relevancia queda implementado y
-- testeado, pero el auto-apply de WhatsApp no se activa hasta validar con un batch real.
create table automation_settings (
  id                     uuid primary key default gen_random_uuid(),
  whatsapp_auto_enabled  boolean not null default false,
  min_confidence         text not null default 'HIGH',
  updated_at             timestamptz not null default now()
);

alter table automation_settings enable row level security;
create policy "authenticated_all" on automation_settings for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

insert into automation_settings (whatsapp_auto_enabled, min_confidence) values (false, 'HIGH');

-- ai_action_log: auditoria de cada accion automatica (AUTO_CREATE/AUTO_UPDATE), Gmail o
-- WhatsApp. Guarda antes/despues A NIVEL DE CAMPO (changed_fields/before_values/
-- after_values), nunca un snapshot completo del work_item — el Undo solo puede revertir
-- exactamente lo que esta fila describe, y solo si nadie mas lo toco despues (ver
-- src/app/api/ai-activity/[id]/undo/route.ts).
create type ai_action_source_type as enum ('GMAIL', 'WHATSAPP');
create type ai_action_type as enum ('CREATE', 'UPDATE');

create table ai_action_log (
  id              uuid primary key default gen_random_uuid(),
  source_type     ai_action_source_type not null,
  action          ai_action_type not null,
  work_item_id    uuid not null references work_item(id) on delete cascade,
  confidence      text not null,
  relevance       text not null,
  reasoning       text,
  changed_fields  text[] not null default '{}',
  before_values   jsonb not null default '{}',
  after_values    jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  undone_at       timestamptz
);

create index ai_action_log_work_item_idx on ai_action_log (work_item_id);
create index ai_action_log_created_at_idx on ai_action_log (created_at desc);

alter table ai_action_log enable row level security;
create policy "authenticated_all" on ai_action_log for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
