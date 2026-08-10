-- Work OS — Schema V1 (Etapa 0 + Etapa 1)
-- Correr una sola vez en el SQL editor de Supabase (o via `supabase db push`).
--
-- Nota para Etapa 2+: quedan pendientes de agregar sin romper este schema:
--   - review_item        (bandeja "Review" para confidence MEDIUM/LOW de fuentes automaticas)
--   - calendar_event_cache
-- No se crean todavia porque nada en Etapa 1 los produce (la captura manual nunca pasa por Review).

create extension if not exists pgcrypto;

-- ---------- Enums ----------
create type work_item_category as enum ('COMERCIAL','TECNICO','OPERACIONES','ADMINISTRATIVO');
create type work_item_status   as enum ('OPEN','DONE','POSTPONED','DELEGATED','IGNORED');
create type contact_tier       as enum ('A','B','C');
create type ai_confidence      as enum ('HIGH','MEDIUM','LOW');
create type source_type        as enum ('MANUAL','GMAIL','WHATSAPP','CALENDAR','ODOO','DRIVE','SLACK','OTHER');
create type source_direction   as enum ('INBOUND','OUTBOUND');

-- ---------- company ----------
create table company (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  notes      text,
  created_at timestamptz not null default now()
);

-- ---------- contact ----------
create table contact (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,
  phone_e164  text,
  company_id  uuid references company(id) on delete set null,
  tier        contact_tier not null default 'B',
  created_at  timestamptz not null default now()
);

-- ---------- context ----------
create table context (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  company_id uuid references company(id) on delete set null,
  notes      text,
  created_at timestamptz not null default now()
);

-- ---------- work_item ----------
create table work_item (
  id                      uuid primary key default gen_random_uuid(),
  title                   text not null,
  context_id              uuid references context(id) on delete set null,
  company_id              uuid references company(id) on delete set null,
  contact_id              uuid references contact(id) on delete set null,
  category                work_item_category,
  status                  work_item_status not null default 'OPEN',
  responsible_id          uuid references contact(id) on delete set null,
  next_action             text,
  waiting_for_what        text,
  waiting_for_contact_id  uuid references contact(id) on delete set null,
  due_date                date,
  expected_date           date,
  committed_date          date,
  follow_up_date          date,
  postponed_until         date,
  blocking                boolean not null default false,
  blocking_note           text,
  estimated_minutes       smallint check (estimated_minutes in (5,15,30,60)),
  last_activity_at        timestamptz not null default now(),
  ai_summary              text,
  ai_confidence           ai_confidence,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index work_item_status_idx        on work_item(status);
create index work_item_due_date_idx      on work_item(due_date);
create index work_item_expected_date_idx on work_item(expected_date);
create index work_item_postponed_idx     on work_item(postponed_until);

-- ---------- note ----------
create table note (
  id           uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references work_item(id) on delete cascade,
  body         text not null,
  created_at   timestamptz not null default now()
);

-- ---------- correction_log ----------
-- Registra cada vez que un valor sugerido por IA es corregido manualmente.
-- Preparado para medir mas adelante: precision HIGH, recall de compromisos, etc. (sin analytics todavia).
create table correction_log (
  id           uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references work_item(id) on delete cascade,
  field        text not null,
  old_value    text,
  new_value    text,
  created_at   timestamptz not null default now()
);

-- ---------- source_link ----------
create table source_link (
  id            uuid primary key default gen_random_uuid(),
  work_item_id  uuid not null references work_item(id) on delete cascade,
  source_type   source_type not null,
  external_id   text,
  external_url  text,
  raw_excerpt   text,
  raw_metadata  jsonb,
  direction     source_direction,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index source_link_work_item_idx on source_link(work_item_id);

-- ---------- updated_at trigger ----------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger work_item_set_updated_at
before update on work_item
for each row execute function set_updated_at();

-- ---------- RLS ----------
-- Work OS es un workspace compartido interno (no multi-tenant): cualquier usuario autenticado
-- (ya restringido por dominio de Google Workspace a nivel app, ver src/app/auth/callback/route.ts)
-- puede leer y escribir todo. No hay columna owner/created_by en V1.
alter table company        enable row level security;
alter table contact        enable row level security;
alter table context        enable row level security;
alter table work_item      enable row level security;
alter table note           enable row level security;
alter table correction_log enable row level security;
alter table source_link    enable row level security;

create policy "authenticated_all" on company        for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on contact        for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on context        for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on work_item       for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on note            for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on correction_log  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated_all" on source_link     for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
