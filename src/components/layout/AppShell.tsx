"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { DraftPanel } from "./DraftPanel";
import { BudgetDraftPanel } from "@/features/budget-management/components/BudgetDraftPanel";
import { ConnectionOfflineBanner } from "./ConnectionOfflineBanner";
import { NewVersionBanner } from "./NewVersionBanner";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { usePreloadEntities } from "@/hooks/useAllEntities";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useIsHydrated } from "@/hooks/useIsHydrated";
import { GlobalSearchModal } from "@/features/global-search/components/GlobalSearchModal";
import { QuickCreateDialog } from "@/features/quick-create/components/QuickCreateDialog";
import { useConnectionHealth, ConnectionHealthContext } from "@/hooks/useConnectionHealth";
import { useVersionCheck, VersionCheckContext } from "@/hooks/useVersionCheck";

/**
 * The four-panel app shell:
 *   TopBar (full width)
 *   └─ Sidebar | Main content | DraftPanel (or BudgetDraftPanel on /budget-management)
 *
 * Guards against unauthenticated access — redirects to /connect if no active
 * connection is present. The guard is intentionally deferred by one tick so
 * that Zustand's sessionStorage rehydration (which runs after mount) has time
 * to populate the store before we decide to redirect.
 *
 * On the /budget-management route, the normal DraftPanel (entity staged changes)
 * is replaced by BudgetDraftPanel (budget cell staged changes) so both panel
 * systems never compete for the same layout slot.
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
  const health = useConnectionHealth();
  const versionCheck = useVersionCheck();

  useEffect(() => {
    if (hydrated && !activeInstance) {
      router.replace("/connect");
    }
  }, [hydrated, activeInstance, router]);

  // Clear persisted filter state when the active connection changes so that
  // stale entity IDs stored in filter values don't carry over to a new budget.
  const prevConnectionIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const currentId = activeInstance?.id;
    if (prevConnectionIdRef.current !== undefined && prevConnectionIdRef.current !== currentId) {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k?.startsWith("filters:")) sessionStorage.removeItem(k);
      }
    }
    prevConnectionIdRef.current = currentId;
  }, [activeInstance?.id]);

  if (!hydrated) {
    return null;
  }

  if (!activeInstance) {
    return null;
  }

  const isBudgetPage = pathname?.startsWith("/budget-management") ?? false;

  return (
    <ConnectionHealthContext.Provider value={health}>
    <VersionCheckContext.Provider value={versionCheck}>
      <div className="flex h-full flex-col">
        <TopBar />
        <ConnectionOfflineBanner />
        <NewVersionBanner />
        <GlobalSearchModal />
        <QuickCreateDialog />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </main>
          {isBudgetPage ? <BudgetDraftPanel /> : <DraftPanel />}
        </div>
      </div>
    </VersionCheckContext.Provider>
    </ConnectionHealthContext.Provider>
  );
}
