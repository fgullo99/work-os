-- Work OS — Performance. Migracion aditiva.
-- work_item.updated_at no tenia indice — lo necesita searchWorkItems (que ya ordena por
-- updated_at sin indice de soporte). El sweep deterministico ("sin actividad hace N dias",
-- ver src/lib/engine/sweep.ts) no agrega una query nueva: corre en memoria sobre los mismos
-- items que getDashboardData ya trae, asi que no necesita un indice propio.
create index if not exists work_item_updated_at_idx on work_item (updated_at);
