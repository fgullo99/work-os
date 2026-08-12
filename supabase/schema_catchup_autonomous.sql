-- Work OS — Gmail catch-up autonomo, pausable y resumible.
-- Migracion aditiva. Correr despues de schema_catchup_retry.sql (ya aplicada).

-- Lock simple contra doble worker (dos pestañas / dos requests simultaneas). Expira solo
-- (ver CATCHUP_LOCK_TTL_MS en src/lib/gmail/catchup.ts) — nunca queda un lock eterno.
alter table gmail_catchup_state add column if not exists worker_locked_at timestamptz null;
alter table gmail_catchup_state add column if not exists worker_id text null;

-- Telemetria de costo (solo metricas, nunca contenido) — acumulado a lo largo de todo el
-- catch-up, para poder estimar el costo real de Work OS mas adelante.
alter table gmail_catchup_state add column if not exists ai_calls_count int not null default 0;
alter table gmail_catchup_state add column if not exists ai_input_tokens bigint not null default 0;
alter table gmail_catchup_state add column if not exists ai_output_tokens bigint not null default 0;
