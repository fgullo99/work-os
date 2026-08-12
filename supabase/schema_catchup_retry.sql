-- Work OS — Gmail catch-up: retry de threads fallidos + contadores delegated/waiting.
-- Migracion aditiva. Correr despues de schema_catchup.sql (ya aplicada).

alter table gmail_catchup_state add column if not exists delegated_count int not null default 0;
alter table gmail_catchup_state add column if not exists waiting_count int not null default 0;

-- Threads que fallaron y todavia no agotaron los reintentos (MAX_RETRY_ATTEMPTS=3 en
-- src/lib/gmail/catchup.ts) — el proximo lote los reintenta primero, antes de seguir
-- avanzando el cursor principal. Array de {threadId, attempts, lastErrorClass,
-- firstFailedAt, lastFailedAt}.
alter table gmail_catchup_state add column if not exists failed_threads jsonb not null default '[]'::jsonb;

-- Threads que agotaron los reintentos — quedan fuera del flujo automatico (diagnostico
-- manual), nunca se reintentan solos de nuevo.
alter table gmail_catchup_state add column if not exists permanently_failed_threads jsonb not null default '[]'::jsonb;
