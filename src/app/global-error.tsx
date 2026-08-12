"use client";

import { useEffect } from "react";

/**
 * Error boundary raiz (Next.js App Router): antes de esto no existia NINGUN error.tsx en
 * toda la app, asi que cualquier excepcion no manejada en un Server o Client Component
 * (ej: NEXT_PUBLIC_SUPABASE_URL faltante en runtime, ver createSupabaseServerClient) tumbaba
 * la pagina entera con el "Application error" generico de Vercel, sin forma de recuperarse
 * sin recargar. global-error.tsx reemplaza TODO el layout raiz mientras esta activo (por eso
 * incluye su propio <html>/<body>), es el ultimo nivel de defensa.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[global-error]", { digest: error.digest, message: error.message, stack: error.stack });
  }, [error]);

  return (
    <html lang="es">
      <body>
        <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Algo salió mal</h1>
            <p style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
              Work OS encontró un error inesperado. Podés intentar de nuevo — si persiste, avisale a Felipe con este
              código: <code>{error.digest ?? "sin digest"}</code>
            </p>
            <button
              type="button"
              onClick={reset}
              style={{ borderRadius: 8, background: "#9C2416", color: "#fff", padding: "8px 16px", fontSize: 14, fontWeight: 500, border: "none", cursor: "pointer" }}
            >
              Reintentar
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
