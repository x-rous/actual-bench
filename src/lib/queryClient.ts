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
