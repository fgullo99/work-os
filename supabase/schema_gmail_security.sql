-- Work OS — Etapa 2b: endurecimiento de seguridad antes de conectar Gmail real.
-- Migracion aditiva. Correr DESPUES de supabase/schema.sql y supabase/schema_gmail.sql.
--
-- Agrega:
--   - google_connection.needs_reconnect / last_error : estado visible cuando el
--     refresh_token quedo invalido (revocado, password cambiada, etc.) — la UI de
--     Settings pasa a mostrar "Gmail needs reconnect" en vez de fallar en silencio.
--   - review_item.feedback : marca manual CORRECT/WRONG/NOT_IMPORTANT sobre cada
--     sugerencia, exclusivamente para medir la calidad del primer bootstrap real
--     (seccion 7 de la validacion). No es un feature del producto, es instrumentacion
--     temporal de validacion.
--
-- Nota sobre access_token/refresh_token: a partir de este cambio de codigo (no de
-- schema — son columnas `text`, no cambia el tipo) esas dos columnas de
-- google_connection dejan de contener el token en texto plano y pasan a contener el
-- valor cifrado con AES-256-GCM (ver src/lib/google/tokenCrypto.ts). Documentado aca
-- con COMMENT ON COLUMN para que sea obvio mirando el schema, no solo el codigo.

alter table google_connection add column needs_reconnect boolean not null default false;
alter table google_connection add column last_error text;

comment on column google_connection.access_token is
  'Cifrado con AES-256-GCM (src/lib/google/tokenCrypto.ts). NUNCA texto plano. Formato: "v1:<iv>:<authTag>:<ciphertext>", todos base64.';
comment on column google_connection.refresh_token is
  'Cifrado con AES-256-GCM (src/lib/google/tokenCrypto.ts). NUNCA texto plano. Formato: "v1:<iv>:<authTag>:<ciphertext>", todos base64.';

create type review_item_feedback as enum ('CORRECT', 'WRONG', 'NOT_IMPORTANT');

alter table review_item add column feedback review_item_feedback;
