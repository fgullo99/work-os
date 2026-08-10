import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente Supabase para Client Components (solo se usa para el boton de login con Google).
 * Sin `<Database>` a proposito — ver la nota en server.ts sobre por que ese generico
 * colapsa a `never` con esta combinacion de versiones de supabase-js/TypeScript.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
