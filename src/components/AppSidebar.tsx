"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

interface Props {
  gmailConnected: boolean;
  gmailEmail?: string | null;
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Inicio" },
  { href: "/dashboard#review", label: "Review" },
  { href: "/settings#companies", label: "Empresas" },
  { href: "/settings#contacts", label: "Contactos" },
  { href: "/settings#contexts", label: "Contextos" },
];

const COLLAPSE_KEY = "workos:sidebar-collapsed";

export function AppSidebar({ gmailConnected, gmailEmail }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  // Se lee recien en el cliente (localStorage no existe en SSR) — arranca expandido y se
  // ajusta al toque si el usuario ya lo habia colapsado antes, sin esperar interaccion.
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "true");
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, String(next));
      return next;
    });
  }

  async function handleSignOut() {
    await fetch("/auth/signout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-ink-100 bg-white py-4 transition-[width] duration-150 ${
        collapsed ? "w-14 px-2" : "w-[200px] px-3"
      }`}
    >
      <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between px-2"}`}>
        {!collapsed && <p className="text-xs font-semibold uppercase tracking-widest text-accent-600">WORK OS</p>}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="rounded-md p-1 text-ink-400 hover:bg-ink-50 hover:text-ink-600"
          title={collapsed ? "Expandir menu" : "Minimizar menu"}
          aria-label={collapsed ? "Expandir menu" : "Minimizar menu"}
        >
          <ChevronIcon direction={collapsed ? "right" : "left"} />
        </button>
      </div>

      <nav className="mt-6 flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const base = item.href.split("#")[0];
          const active = pathname === base;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`rounded-md py-1.5 text-sm font-medium transition ${collapsed ? "text-center" : "px-2.5"} ${
                active ? "bg-accent-50 text-accent-600" : "text-ink-600 hover:bg-ink-50"
              }`}
            >
              {collapsed ? item.label.slice(0, 1) : item.label}
            </Link>
          );
        })}
      </nav>

      <div className="my-4 border-t border-ink-100" />

      {collapsed ? (
        <div className="flex flex-col items-center gap-2">
          <SourceDot label="Gmail" connected={gmailConnected} detail={gmailConnected ? (gmailEmail ?? "Conectado") : "No conectado"} />
          <SourceDot label="WhatsApp" connected={false} detail="Sin integracion" />
          <SourceDot label="Calendar" connected={false} detail="Proximamente" />
        </div>
      ) : (
        <>
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Fuentes</p>
          <div className="mt-2 flex flex-col gap-2 px-2">
            <SourceRow label="Gmail" connected={gmailConnected} detail={gmailConnected ? (gmailEmail ?? "Conectado") : "No conectado"} />
            <SourceRow label="WhatsApp" connected={false} detail="Sin integracion" />
            <SourceRow label="Calendar" connected={false} detail="Proximamente" />
          </div>
        </>
      )}

      <div className="my-4 border-t border-ink-100" />

      <Link
        href="/settings"
        title={collapsed ? "Configuracion" : undefined}
        className={`rounded-md py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-50 ${collapsed ? "text-center" : "px-2.5"}`}
      >
        {collapsed ? "C" : "Configuracion"}
      </Link>

      <div className="mt-auto flex flex-col gap-0.5 pt-4">
        {!collapsed && (
          <p className="cursor-default rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-400" title="Documentacion en README.md">
            Ayuda
          </p>
        )}
        <button
          type="button"
          onClick={handleSignOut}
          title={collapsed ? "Cerrar sesion" : undefined}
          className={`flex items-center rounded-md py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-50 ${
            collapsed ? "justify-center" : "px-2.5"
          }`}
        >
          {collapsed ? <SignOutIcon /> : "Cerrar sesion"}
        </button>
      </div>
    </aside>
  );
}

function SignOutIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={direction === "right" ? "rotate-180" : undefined}
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function SourceRow({ label, connected, detail }: { label: string; connected: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="flex shrink-0 items-center gap-1.5 text-ink-600">
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-ink-300"}`} aria-hidden="true" />
        {label}
      </span>
      <span className="truncate text-ink-400" title={detail}>
        {detail}
      </span>
    </div>
  );
}

function SourceDot({ label, connected, detail }: { label: string; connected: boolean; detail: string }) {
  return (
    <span
      className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-ink-300"}`}
      title={`${label}: ${detail}`}
      aria-label={`${label}: ${detail}`}
    />
  );
}
