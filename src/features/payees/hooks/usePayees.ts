"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPayees } from "@/lib/api/payees";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";

/**
 * Fetches payees from the API and loads them into the staged store.
 * Re-runs whenever the active connection changes.
 */
export function usePayees() {
  const connection = useConnectionStore(selectActiveInstance);
  const loadPayees = useStagedStore((s) => s.loadPayees);

  const query = useQuery({
    queryKey: ["payees", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getPayees(connection);
    },
    enabled: !!connection,
    // Architecture: React Query is a fetch trigger and loading/error provider
    // only. All entity data lives in the Zustand staged store (loadPayees).
    // See useAccounts.ts for a full explanation of these settings.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (query.data) {
      loadPayees(query.data);
    }
  }, [query.data, loadPayees]);

  return query;
}
