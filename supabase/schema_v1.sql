-- Work OS — V1 (puesta en uso real). Migracion aditiva.
-- Correr DESPUES de schema.sql, schema_gmail.sql y schema_gmail_security.sql.
--
-- Agrega:
--   - is_demo en company/contact/context/work_item/source_link/review_item: permite
--     purgar SOLO los datos de demostracion (scripts/seed.ts) sin tocar datos reales.
--     Todo lo creado por flujos reales (captura manual, Gmail, WhatsApp) queda en false
--     por default — nunca hay que marcarlo a mano.
--   - safe_mode en google_connection: mientras esta en true, el sync de Gmail NUNCA
--     crea ni actualiza Work Items solo — todo lo que hubiera sido HIGH/MEDIUM/
--     Potential Commitment va a Review, y se guarda que accion se habria tomado
--     (ver src/lib/gmail/applySync.ts). Arranca en true a proposito: el primer
--     bootstrap real siempre es observacional.

alter table company add column is_demo boolean not null default false;
alter table contact add column is_demo boolean not null default false;
alter table context add column is_demo boolean not null default false;
alter table work_item add column is_demo boolean not null default false;
alter table source_link add column is_demo boolean not null default false;
alter table review_item add column is_demo boolean not null default false;

alter table google_connection add column safe_mode boolean not null default true;
