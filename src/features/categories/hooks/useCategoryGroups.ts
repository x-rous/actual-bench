"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCategoryGroups } from "@/lib/api/categoryGroups";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";

type PreloadOptions = {
  enabled?: boolean;
};

/**
 * Fetches category groups (with nested categories) from the API and loads
 * both into the staged store in a single call.
 */
export function useCategoryGroups(options: PreloadOptions = {}) {
  const connection = useConnectionStore(selectActiveInstance);
  const loadCategoryGroups = useStagedStore((s) => s.loadCategoryGroups);

  const query = useQuery({
    queryKey: ["categoryGroups", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getCategoryGroups(connection);
    },
    enabled: !!connection && (options.enabled ?? true),
    // staleTime/gcTime/refetchOn* are set globally in queryClient.ts.
  });

  useEffect(() => {
    if (query.data) {
      loadCategoryGroups(query.data.groups, query.data.categories);
    }
  }, [query.data, loadCategoryGroups]);

  return query;
}
