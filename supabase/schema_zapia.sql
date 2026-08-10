-- Work OS — Zapia (WhatsApp ingestion). Migracion aditiva.
-- Correr DESPUES de schema.sql, schema_gmail.sql, schema_gmail_security.sql y schema_v1.sql.
--
-- whatsapp_ingestion registra CADA entrega del webhook de Zapia (una fila por conversacion
-- recibida, no por mensaje individual). Dos motivos para que exista como tabla propia en vez
-- de reusar review_item directamente:
--   1) Idempotencia real a nivel DB: idempotency_key es UNIQUE, asi que un POST reintentado
--      por Zapia (mismo idempotency_key) choca contra la constraint en vez de duplicar nada.
--   2) Tracking de errores/retry (seccion 14 del spec): si Anthropic falla, necesitamos un
--      lugar para guardar "esto llego pero no se pudo procesar todavia" — un review_item no
--      sirve para eso porque, por definicion, si algo fallo nunca se llego a crear.
-- Tambien es la fuente de datos para el panel de Settings (Last batch / Last successful sync
-- / Errors) sin necesitar una tabla de "conexion" separada como la de Gmail.

create type whatsapp_ingestion_status as enum ('RECEIVED', 'PROCESSED', 'IGNORED', 'ERROR');

create table whatsapp_ingestion (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null default 'zapia',
  idempotency_key  text not null unique,
  batch_id         text,
  chat_id          text,
  contact_name     text,
  message_count    integer not null default 0,
  status           whatsapp_ingestion_status not null default 'RECEIVED',
  error_message    text,
  review_item_id   uuid references review_item(id) on delete set null,
  is_demo          boolean not null default false,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz
);

create index whatsapp_ingestion_received_at_idx on whatsapp_ingestion (received_at desc);
create index whatsapp_ingestion_status_idx on whatsapp_ingestion (status);
