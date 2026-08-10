-- Work OS — Etapa 2: Gmail + Review
-- Migracion aditiva. Correr DESPUES de supabase/schema.sql (no lo reemplaza, no lo toca).
--
-- Agrega:
--   - google_connection : credenciales OAuth de Gmail (read-only) + cursor de sync
--   - review_item        : bandeja unica "Review" (fusion de AI Suggestions + Potential
--                           Commitments + Updates + Possible Duplicates + Received Check,
--                           tal como definio el spec de producto para V1)
--   - work_item.last_message_direction : ultima direccion de mensaje conocida en el
--                           thread de Gmail asociado, usada por el Priority Engine para
--                           el factor "someone_waiting" (seccion 16 de la especificacion
--                           de Etapa 2). Nullable — sigue siendo null para Work Items sin
--                           fuente Gmail.

create type review_item_kind as enum (
  'NEW_WORK_ITEM',
  'UPDATE_WORK_ITEM',
  'POTENTIAL_COMMITMENT',
  'POSSIBLE_DUPLICATE',
  'RECEIVED_CHECK'
);

create type review_item_status as enum ('PENDING', 'ACCEPTED', 'APPLIED', 'IGNORED');

-- ---------- google_connection ----------
-- V1 asume una unica conexion de Gmail para todo el workspace (no multi-cuenta).
-- Los tokens permiten refrescar el access_token en background (fuera de una sesion de
-- usuario) usando GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET propios — ver
-- src/lib/google/oauthClient.ts para el porque.
--
-- SEGURIDAD: access_token/refresh_token quedan en texto plano en esta tabla en V1,
-- protegidos solo por RLS (igual que el resto del schema). Es una limitacion conocida
-- documentada en el README — cifrado a nivel de columna (pgsodium/Vault) queda para
-- una iteracion posterior si se decide operar esto en produccion mas alla de uso interno.
create table google_connection (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null,
  access_token         text not null,
  refresh_token        text not null,
  token_expires_at     timestamptz not null,
  scope                text not null,
  history_id           text,
  bootstrap_completed_at timestamptz,
  bootstrap_range_days smallint,
  last_synced_at       timestamptz,
  last_sync_summary    jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger google_connection_set_updated_at
before update on google_connection
for each row execute function set_updated_at();

-- ---------- review_item ----------
-- Bandeja unica. NO hay tablas separadas para "AI Suggestions" vs "Potential Commitments"
-- (decision tomada en el spec de producto V2 — ver WorkOS-MVP-Spec.md seccion 2).
create table review_item (
  id                 uuid primary key default gen_random_uuid(),
  kind               review_item_kind not null,
  status             review_item_status not null default 'PENDING',

  -- null cuando kind=NEW_WORK_ITEM (todavia no existe el Work Item)
  work_item_id       uuid references work_item(id) on delete cascade,

  -- Para POSSIBLE_DUPLICATE: candidato(s) a los que se podria linkear en vez de crear nuevo.
  duplicate_candidate_ids uuid[],

  -- Datos normalizados propuestos (title, next_action, waiting_for_*, fechas ya resueltas,
  -- category, blocking, suggested_company/contact/context, etc.) — mismo shape conceptual
  -- que CreateWorkItemInput/updateWorkItem, se aplica tal cual al aceptar/aplicar.
  proposed_payload   jsonb not null,

  confidence         ai_confidence not null,
  rationale          text,
  evidence           text,

  -- Referencia a la fuente Gmail que origino esta sugerencia. No se crea un source_link
  -- todavia (esa tabla exige work_item_id NOT NULL) — se crea recien al aceptar/aplicar.
  source_type        source_type not null default 'GMAIL',
  external_id        text,        -- thread_id
  external_message_id text,
  external_url       text,
  raw_excerpt        text,
  raw_metadata       jsonb,
  direction          source_direction,
  occurred_at        timestamptz,

  created_at         timestamptz not null default now(),
  resolved_at        timestamptz
);

create index review_item_status_idx on review_item(status);
create index review_item_work_item_idx on review_item(work_item_id);
create index review_item_external_id_idx on review_item(external_id);

alter table google_connection enable row level security;
alter table review_item enable row level security;

create policy "authenticated_all" on google_connection for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on review_item for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------- work_item: nueva columna ----------
alter table work_item add column last_message_direction source_direction;
