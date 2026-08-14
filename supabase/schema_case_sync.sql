-- Work OS — Sync incremental de Case (item 42 del pedido). Migracion aditiva.
--
-- El cron diario de /api/gmail/sync solo corria el pipeline viejo de Work Item
-- (runIncrementalSync), asi que las respuestas nuevas de Gmail nunca volvian a analizar el
-- Case correspondiente y quedaba desactualizado. case_history_id es un cursor SEPARADO del
-- history_id que ya usa Work Item — cada pipeline consume su propio rango de la Gmail History
-- API sin pisar al otro (consumir un rango de historyId es destructivo: una vez leido, ese
-- rango no vuelve a aparecer).
alter table google_connection add column if not exists case_history_id text;
alter table google_connection add column if not exists last_case_synced_at timestamptz;
alter table google_connection add column if not exists last_case_sync_summary jsonb;
