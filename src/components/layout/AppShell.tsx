"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { DraftPanel } from "./DraftPanel";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";

// useSyncExternalStore is the React-recommended way to detect client-side
// hydration without calling setState inside useEffect.
const emptySubscribe = () => () => {};
function useIsHydrated(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

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
  const activeInstance = useConnectionStore(selectActiveInstance);

  // Returns false on the server, true on the client — no setState needed.
  const hydrated = useIsHydrated();

  useEffect(() => {
    if (hydrated && !activeInstance) {
      router.replace("/connect");
    }
  }, [hydrated, activeInstance, router]);

  // Show nothing until we know whether the user is connected.
  if (!hydrated) {
    return null;
  }

  if (!activeInstance) {
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 flex-col overflow-auto">
          {children}
        </main>
        <DraftPanel />
      </div>
    </div>
  );
}
