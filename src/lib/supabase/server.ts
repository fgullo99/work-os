import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Cliente Supabase para Server Components y Route Handlers.
 * Usa la sesion del usuario (cookies), no una service role key —
 * toda la autorizacion pasa por las policies de RLS en supabase/schema.sql.
 *
 * NOTA: a proposito NO se parametriza con `<Database>` aca. Con
 * @supabase/supabase-js 2.11x + TypeScript 5.9, el default interno de
 * SupabaseClient (`Schema extends GenericSchema ? Schema : never`) colapsa a
 * `never` con un Database escrito a mano — confirmado con pruebas aisladas,
 * no depende de la forma exacta del tipo (probamos con object literals planos,
 * sin interseccion, con Relationships/Views/Functions explicitos, y sigue
 * fallando en esta combinacion de versiones). El costo es real pero acotado:
 * se pierde el chequeo de nombres de tabla/columna en compile-time de
 * supabase-js. La seguridad de tipos de la app se mantiene igual en todos los
 * limites que SI controlamos: los parametros/retornos de cada funcion en
 * src/lib/workItems/*.ts siguen tipados contra Database Row/Insert types.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Los Server Components no pueden escribir cookies fuera de una Server Action /
            // Route Handler. El middleware (src/middleware.ts) se encarga de refrescar la sesion.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // idem arriba
          }
        },
      },
    }
  );
}

/**
 * Tipo del cliente devuelto por createSupabaseServerClient(), derivado con ReturnType
 * en vez de reconstruido a mano como SupabaseClient<Database, ...>. Las versiones de
 * @supabase/supabase-js han cambiado la forma exacta de esos generics mas de una vez;
 * ReturnType evita que el resto del codigo tenga que acoplarse a esa forma interna.
 */
export type SupabaseServerClient = ReturnType<typeof createSupabaseServerClient>;
