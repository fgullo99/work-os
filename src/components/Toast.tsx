"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface ToastItem {
  id: number;
  message: string;
  tone: "error" | "info";
}

interface ToastContextValue {
  show: (message: string, tone?: "error" | "info") => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Toast discreto sin libreria nueva — usado para avisar cuando una accion optimista
 * (Done/Postpone/Delegate/Received/autosave) falla y se hizo rollback. Se autodescarta a
 * los 4s, tambien se puede cerrar a mano. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, tone: "error" | "info" = "error") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-md px-3 py-2 text-sm text-white shadow-popover ${
              t.tone === "error" ? "bg-risk-600" : "bg-ink-800"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}
