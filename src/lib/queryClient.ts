"use client";

import { QueryClient } from "@tanstack/react-query";

/**
 * Creates a TanStack Query client configured for this app.
 * Data is never persisted — all caches are session-only.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Retry once on failure before surfacing an error
        retry: 1,
        // Architecture: React Query is a fetch trigger and loading/error provider
        // only. All entity data lives in the Zustand staged store.
        //
        // staleTime: Infinity — we own cache invalidation via invalidateQueries
        // after a save. The queryKey already changes on connection switch, which
        // triggers a fresh fetch. Auto-staleness is not needed and would cause
        // unnecessary refetches on remount.
        //
        // refetchOnWindowFocus/Reconnect: disabled because a background refetch
        // would call loadXxx and silently overwrite unsaved staged edits.
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}

/**
 * Caches about Actual Bench itself rather than the open budget: whether this
 * browser is signed in, the saved connections, the credential vault. They stay
 * valid whichever budget is open.
 */
const APP_QUERY_ROOTS = new Set(["auth-status", "remembered-servers", "vault-state"]);

/**
 * Forget everything cached for the budget being left, before another one opens,
 * and stop what is still loading for it.
 * Keeps the app-level caches, so the account menu and saved budgets don't blink
 * out and load again on every switch.
 */
export function clearBudgetQueries(queryClient: QueryClient): void {
  const predicate = (query: { queryKey: readonly unknown[] }) => !APP_QUERY_ROOTS.has(String(query.queryKey[0]));
  // Cancel first: a request still on its way for the budget being left, or its
  // retry, must not reach for that budget once another one is opening.
  void queryClient.cancelQueries({ predicate });
  queryClient.removeQueries({ predicate });
}
