"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRules } from "@/lib/api/rules";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";

export function useRules() {
  const connection = useConnectionStore(selectActiveInstance);
  const loadRules = useStagedStore((s) => s.loadRules);

  const query = useQuery({
    queryKey: ["rules", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getRules(connection);
    },
    enabled: !!connection,
    // Architecture: React Query is a fetch trigger and loading/error provider
    // only. All entity data lives in the Zustand staged store (loadRules).
    // See useAccounts.ts for a full explanation of these settings.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (query.data) {
      loadRules(query.data);
    }
  }, [query.data, loadRules]);

  return query;
}
