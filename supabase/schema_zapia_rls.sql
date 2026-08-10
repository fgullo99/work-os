-- Work OS — Fix: falto habilitar RLS + policy en whatsapp_ingestion (schema_zapia.sql
-- se olvido de esto, a diferencia de todas las demas tablas en schema.sql). Sin esto,
-- cualquier acceso con el cliente de sesion (no service role) a whatsapp_ingestion queda
-- bloqueado — INSERT tira "new row violates row-level security policy" y SELECT devuelve
-- siempre 0 filas en silencio.
--
-- Mismo patron que el resto de las tablas (ver supabase/schema.sql lineas 129-147).

alter table whatsapp_ingestion enable row level security;

create policy "authenticated_all" on whatsapp_ingestion
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
