"use client";

import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const ERROR_MESSAGES: Record<string, string> = {
  domain_not_allowed: "Esa cuenta de Google no pertenece a la organizacion. Inicia sesion con tu cuenta corporativa.",
  auth_failed: "No se pudo completar el inicio de sesion. Intenta de nuevo.",
  missing_code: "No se pudo completar el inicio de sesion. Intenta de nuevo.",
};

export function LoginForm() {
  const params = useSearchParams();
  const error = params.get("error");
  const redirectTo = params.get("redirectTo") ?? "/dashboard";

  async function handleLogin() {
    const supabase = createSupabaseBrowserClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${siteUrl}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`,
      },
    });
  }

  return (
    <div className="w-full max-w-sm rounded-xl border border-ink-100 bg-white p-8 shadow-card">
      <div className="mb-8">
        <p className="text-sm font-medium tracking-wide text-accent-600">WORK OS</p>
        <h1 className="mt-2 text-xl font-semibold text-ink-900">Iniciar sesion</h1>
        <p className="mt-1 text-sm text-ink-500">
          Capa de atencion y seguimiento sobre tu trabajo.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-risk-100 bg-risk-100 px-3 py-2 text-sm text-risk-600">
          {ERROR_MESSAGES[error] ?? "Ocurrio un error al iniciar sesion."}
        </div>
      )}

      <button
        onClick={handleLogin}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-800 shadow-card transition hover:bg-ink-50"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.61z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z"
          />
          <path
            fill="#FBBC05"
            d="M3.97 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.33z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
          />
        </svg>
        Continuar con Google
      </button>

      <p className="mt-6 text-center text-xs text-ink-400">
        Acceso restringido a cuentas del Google Workspace de la organizacion.
      </p>
    </div>
  );
}
