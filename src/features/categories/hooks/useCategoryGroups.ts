"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCategoryGroups } from "@/lib/api/categoryGroups";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";

/**
 * Fetches category groups (with nested categories) from the API and loads
 * both into the staged store in a single call.
 */
export function useCategoryGroups() {
  const connection = useConnectionStore(selectActiveInstance);
  const loadCategoryGroups = useStagedStore((s) => s.loadCategoryGroups);

  const query = useQuery({
    queryKey: ["categoryGroups", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getCategoryGroups(connection);
    },
    enabled: !!connection,
    // Architecture: React Query is a fetch trigger and loading/error provider
    // only. All entity data lives in the Zustand staged store (loadCategoryGroups).
    // See useAccounts.ts for a full explanation of these settings.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (query.data) {
      loadCategoryGroups(query.data.groups, query.data.categories);
    }
  }, [query.data, loadCategoryGroups]);

  return query;
}
