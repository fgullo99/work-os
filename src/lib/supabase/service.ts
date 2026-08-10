import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase con la service role key — bypassa RLS. SOLO para codigo server-only
 * que necesita operar sin sesion de usuario (el pipeline de sync de Gmail, disparado por
 * cron, no tiene cookies de sesion). Nunca importar esto desde un componente cliente ni
 * desde una API route que responda directamente a input de usuario sin validar autorizacion
 * primero (ver el chequeo dual-auth en src/app/api/gmail/sync/route.ts).
 */
export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY para el cliente de servicio.");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;
