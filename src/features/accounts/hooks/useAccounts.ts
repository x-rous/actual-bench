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
    // staleTime/gcTime/refetchOn* are set globally in queryClient.ts.
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
