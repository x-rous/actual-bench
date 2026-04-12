"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { DraftPanel } from "./DraftPanel";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { usePreloadEntities } from "@/hooks/useAllEntities";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useIsHydrated } from "@/hooks/useIsHydrated";

/**
 * The four-panel app shell:
 *   TopBar (full width)
 *   └─ Sidebar | Main content | DraftPanel
 *
 * Guards against unauthenticated access — redirects to /connect if no active
 * connection is present. The guard is intentionally deferred by one tick so
 * that Zustand's sessionStorage rehydration (which runs after mount) has time
 * to populate the store before we decide to redirect.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const activeInstance = useConnectionStore(selectActiveInstance);

  // Overview is a lightweight landing page, so avoid booting the full entity
  // preload set while the user is on /overview. Other app routes keep the
  // existing eager-preload behavior.
  usePreloadEntities(pathname !== "/overview");
  useKeyboardShortcuts();

  const hydrated = useIsHydrated();

  useEffect(() => {
    if (hydrated && !activeInstance) {
      router.replace("/connect");
    }
  }, [hydrated, activeInstance, router]);

  if (!hydrated) {
    return null;
  }

  if (!activeInstance) {
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
        <DraftPanel />
      </div>
    </div>
  );
}
