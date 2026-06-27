"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { fetchBudgetPreferences } from "@/lib/api/preferences";
import type { BudgetMode } from "../types";

/**
 * Reads the active budget mode from the `preferences` table (the `budgetType`
 * key): "tracking" when present with that value, "envelope" otherwise. This is
 * the canonical, data-independent detection — a fresh/empty budget is still
 * classified correctly. Shares the cached preferences fetch with
 * useBudgetPreferences via the same query key.
 *
 * Returns `undefined` while loading so consumers can show their loading
 * ("unidentified") state rather than flashing a default mode.
 */
export function useBudgetMode(): {
  data: BudgetMode | undefined;
  isLoading: boolean;
  error: unknown;
} {
  const connection = useConnectionStore(selectActiveInstance);

  const query = useQuery({
    queryKey: ["budgetPreferences", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return fetchBudgetPreferences(connection);
    },
    enabled: !!connection,
    staleTime: 5 * 60 * 1000,
  });

  return {
    data: query.data?.budgetMode,
    isLoading: query.isLoading,
    error: query.error,
  };
}
