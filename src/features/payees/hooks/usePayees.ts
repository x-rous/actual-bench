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
    // staleTime/gcTime/refetchOn* are set globally in queryClient.ts.
  });

  useEffect(() => {
    if (query.data) {
      loadPayees(query.data);
    }
  }, [query.data, loadPayees]);

  return query;
}
