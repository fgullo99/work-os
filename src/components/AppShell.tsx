import type { ReactNode } from "react";
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

export function AppShell({ userFirstName, gmailConnected, gmailEmail, onOpenCapture, rightPanel, children }: Props) {
  return (
    <div className="flex h-screen overflow-hidden bg-ink-50">
      <AppSidebar gmailConnected={gmailConnected} gmailEmail={gmailEmail} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar userFirstName={userFirstName} onOpenCapture={onOpenCapture} />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
          {rightPanel && (
            <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-ink-100 bg-white px-4 py-6 lg:block">
              {rightPanel}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
