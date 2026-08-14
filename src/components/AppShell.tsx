"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";

interface Props {
  userFirstName: string;
  gmailConnected: boolean;
  gmailEmail?: string | null;
  onOpenCapture?: () => void;
  rightPanel?: ReactNode;
  children: ReactNode;
}

const COLLAPSE_KEY = "workos:rightpanel-collapsed";

export function AppShell({ userFirstName, gmailConnected, gmailEmail, onOpenCapture, rightPanel, children }: Props) {
  const [collapsed, setCollapsed] = useState(false);

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

  return (
    <div className="flex h-screen overflow-hidden bg-ink-50">
      <AppSidebar gmailConnected={gmailConnected} gmailEmail={gmailEmail} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar userFirstName={userFirstName} onOpenCapture={onOpenCapture} />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
          {rightPanel && (
            <aside
              className={`hidden shrink-0 overflow-y-auto border-l border-ink-100 bg-white transition-[width] duration-150 lg:flex lg:flex-col ${
                collapsed ? "w-11" : "w-[300px]"
              }`}
            >
              <button
                type="button"
                onClick={toggleCollapsed}
                className={`m-2 shrink-0 rounded-md p-1 text-ink-400 hover:bg-ink-50 hover:text-ink-600 ${
                  collapsed ? "self-center" : "self-end"
                }`}
                title={collapsed ? "Expandir panel" : "Minimizar panel"}
                aria-label={collapsed ? "Expandir panel" : "Minimizar panel"}
              >
                <ChevronIcon direction={collapsed ? "left" : "right"} />
              </button>
              {!collapsed && <div className="px-4 pb-6">{rightPanel}</div>}
            </aside>
          )}
        </div>
      </div>
    </div>
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
