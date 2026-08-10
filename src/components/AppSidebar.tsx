"use client";

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

export function AppSidebar({ gmailConnected, gmailEmail }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await fetch("/auth/signout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-full w-[200px] shrink-0 flex-col border-r border-ink-100 bg-white px-3 py-4">
      <p className="px-2 text-xs font-semibold uppercase tracking-widest text-accent-600">WORK OS</p>

      <nav className="mt-6 flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const base = item.href.split("#")[0];
          const active = pathname === base;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition ${
                active ? "bg-accent-50 text-accent-600" : "text-ink-600 hover:bg-ink-50"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="my-4 border-t border-ink-100" />

      <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Fuentes</p>
      <div className="mt-2 flex flex-col gap-2 px-2">
        <SourceRow label="Gmail" connected={gmailConnected} detail={gmailConnected ? (gmailEmail ?? "Conectado") : "No conectado"} />
        <SourceRow label="WhatsApp" connected={false} detail="Sin integracion" />
        <SourceRow label="Calendar" connected={false} detail="Proximamente" />
      </div>

      <div className="my-4 border-t border-ink-100" />

      <Link href="/settings" className="rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-50">
        Configuracion
      </Link>

      <div className="mt-auto flex flex-col gap-0.5 pt-4">
        <p
          className="cursor-default rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-400"
          title="Documentacion en README.md"
        >
          Ayuda
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-ink-600 hover:bg-ink-50"
        >
          Cerrar sesion
        </button>
      </div>
    </aside>
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
