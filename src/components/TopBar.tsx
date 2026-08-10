"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface Props {
  userFirstName: string;
  onOpenCapture?: () => void;
}

export function TopBar({ userFirstName, onOpenCapture }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    if (query.trim()) router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  function handleCaptureClick() {
    if (onOpenCapture) onOpenCapture();
    else router.push("/dashboard?capture=1");
  }

  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-ink-100 bg-white px-6 py-3">
      <form onSubmit={handleSearchSubmit} className="max-w-md flex-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar en todo..."
          className="input"
          type="search"
        />
      </form>
      <div className="flex items-center gap-3">
        <button type="button" onClick={handleCaptureClick} className="btn-primary">
          + Capturar
        </button>
        <div className="rounded-md p-1.5 text-ink-400" title="Notificaciones (proximamente)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>
        <span className="text-sm font-medium text-ink-700">{userFirstName}</span>
      </div>
    </header>
  );
}
