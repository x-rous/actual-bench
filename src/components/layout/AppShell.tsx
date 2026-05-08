"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { DraftPanel } from "./DraftPanel";
import { BudgetDraftPanel } from "@/features/budget-management/components/BudgetDraftPanel";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { usePreloadEntities } from "@/hooks/useAllEntities";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useIsHydrated } from "@/hooks/useIsHydrated";
import { GlobalSearchModal } from "@/features/global-search/components/GlobalSearchModal";

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

  const isBudgetPage = pathname?.startsWith("/budget-management") ?? false;

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <GlobalSearchModal />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
        {isBudgetPage ? <BudgetDraftPanel /> : <DraftPanel />}
      </div>
    </div>
  );
}
