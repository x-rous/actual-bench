"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
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
import { useBudgetPreferences } from "@/hooks/useBudgetPreferences";
import {
  clearSessionRecord,
  getSessionRecord,
  recordOf,
  setSessionRecord,
} from "@/features/connect/sessionRecord";
import { resumeSession } from "@/features/connect/resumeSession";

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
 * Before redirecting, it tries once — the first time it sees no active
 * connection after hydration — to silently resume the budgets this tab had
 * before a refresh (the in-memory connection store is always empty on reload
 * — see connection.ts), using the non-secret record in sessionRecord.ts plus
 * the remembered-server vault: the active one reopened, the others back in
 * the switcher. If there's no record, the vault is locked, or the active one
 * can't be reopened, it falls through to /connect exactly as before. Any *later* loss of the active connection (an explicit
 * disconnect) always goes straight to /connect — vault-resume is a
 * page-load feature, not an auto-reconnect-on-disconnect feature.
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
  useBudgetPreferences();

  const hydrated = useIsHydrated();
  const health = useConnectionHealth();
  const versionCheck = useVersionCheck();

  // Snapshot the resumable pointer exactly once, on the first render after
  // hydration — never recomputed afterward. This is what makes the resume
  // attempt below a one-shot, page-load-only thing: a later disconnect
  // doesn't re-read a (by-then-cleared) pointer and doesn't retry.
  const pendingResumeRef = useRef<{ v: ReturnType<typeof getSessionRecord> } | null>(null);
  if (hydrated) {
    if (pendingResumeRef.current === null) {
      pendingResumeRef.current = { v: activeInstance ? null : getSessionRecord() };
    }
  }
  // Set once a real connection has existed during this mount, so a later
  // disconnect is never mistaken for "just refreshed, try to resume".
  const hadActiveInstanceRef = useRef(false);

  // Rendering must not read refs, so this re-reads the pointer directly
  // rather than the snapshot above. It can very briefly read a not-yet-
  // cleared pointer right on a disconnect (before the effect below redirects
  // instead of resuming) — a one-frame cosmetic flash at worst, since the
  // effect's own hadActiveInstanceRef check is what actually prevents a
  // reconnect.
  const isResuming = hydrated && !activeInstance && !!getSessionRecord();

  useEffect(() => {
    if (!hydrated || activeInstance) return;

    if (hadActiveInstanceRef.current) {
      // Was connected earlier this session, isn't now — an explicit
      // disconnect, not a fresh page load. Never re-attempt vault-resume.
      router.replace("/connect");
      return;
    }

    const pending = pendingResumeRef.current?.v ?? null;
    if (!pending) {
      router.replace("/connect");
      return;
    }

    let cancelled = false;
    resumeSession(pending).catch(() => {
      // Stale/inaccessible record (vault locked, budget forgotten, server
      // unreachable) — fall back to the normal connect flow.
      if (!cancelled) {
        clearSessionRecord();
        router.replace("/connect");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [hydrated, activeInstance, router]);

  // Remember which budgets are connected and which is active (non-secret
  // record only) so a refresh can bring them back above instead of always
  // bouncing to /connect. Clearing on disconnect keeps a refresh right after
  // disconnecting from silently reconnecting the user.
  const instances = useConnectionStore((s) => s.instances);
  useEffect(() => {
    if (activeInstance) {
      hadActiveInstanceRef.current = true;
      setSessionRecord(recordOf(activeInstance, instances));
    } else if (hadActiveInstanceRef.current) {
      clearSessionRecord();
    }
  }, [activeInstance, instances]);

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

  if (isResuming) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reconnecting...
      </div>
    );
  }

  if (!activeInstance) {
    return null;
  }

  const isBudgetPage = pathname?.startsWith("/budget-management") ?? false;
  // The reconciliation workbench needs the full content width for its
  // three-column Bank | Match | Actual grid, and stages its own changes rather
  // than through the entity staged store, so the global draft panel is hidden.
  const isReconciliationPage = pathname?.startsWith("/reconciliation") ?? false;

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
          {isReconciliationPage ? null : isBudgetPage ? <BudgetDraftPanel /> : <DraftPanel />}
        </div>
      </div>
    </VersionCheckContext.Provider>
    </ConnectionHealthContext.Provider>
  );
}
