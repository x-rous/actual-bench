"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAccounts } from "@/lib/api/accounts";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";

/**
 * Fetches accounts from the API and loads them into the staged store.
 * Re-runs whenever the active connection changes.
 */
export function useAccounts() {
  const connection = useConnectionStore(selectActiveInstance);
  const loadAccounts = useStagedStore((s) => s.loadAccounts);

  const query = useQuery({
    queryKey: ["accounts", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getAccounts(connection);
    },
    enabled: !!connection,
    // Architecture: React Query is a fetch trigger and loading/error provider
    // only. All entity data lives in the Zustand staged store (loadAccounts).
    //
    // staleTime: Infinity — we own cache invalidation via invalidateQueries
    // after a save. The queryKey already changes on connection switch, which
    // triggers a fresh fetch. Auto-staleness is not needed and would cause
    // unnecessary refetches on remount.
    //
    // refetchOnWindowFocus/Reconnect: disabled because a background refetch
    // would call loadAccounts and silently overwrite unsaved staged edits.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // When server data arrives, populate the staged store. This resets any
  // unsaved edits for this entity type — intentional after a successful save
  // or on first load.
  useEffect(() => {
    if (query.data) {
      loadAccounts(query.data);
    }
  }, [query.data, loadAccounts]);

  return query;
}
