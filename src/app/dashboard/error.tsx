"use client";

import { useEffect } from "react";

/** Error boundary del Dashboard: si getDashboardData/companies/contacts/contexts/reviewItems
 * fallan (ver src/app/dashboard/page.tsx), esto se muestra en vez del crash generico, y
 * /settings, /search, etc. siguen andando (este boundary no afecta al resto de la app). */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[dashboard/error]", { digest: error.digest, message: error.message, stack: error.stack });
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
      <h1 className="text-lg font-semibold text-ink-800">No se pudo cargar el Dashboard</h1>
      <p className="mt-2 text-sm text-ink-500">
        Hubo un error inesperado trayendo tus datos. Podés reintentar — si sigue pasando, avisale a Felipe con este
        código: <code className="text-xs">{error.digest ?? "sin digest"}</code>
      </p>
      <button type="button" onClick={reset} className="btn-primary mt-4">
        Reintentar
      </button>
    </div>
  );
}
