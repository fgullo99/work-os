"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * En desktop arranca abierto. En mobile arranca cerrado (spec: "TODAY primero,
 * los demas bloques colapsables"). El chequeo de ancho se hace en efecto (cliente)
 * para no romper el render del servidor.
 */
export function Collapsible({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (isMobile) setOpen(false);
  }, []);

  return (
    <section className="card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left"
      >
        <span className="text-sm font-semibold text-ink-800">
          {title}
          {typeof count === "number" ? ` (${count})` : ""}
        </span>
        <span className={`text-ink-400 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true">
          {"›"}
        </span>
      </button>
      {open && <div className="border-t border-ink-100 px-5 py-4">{children}</div>}
    </section>
  );
}
