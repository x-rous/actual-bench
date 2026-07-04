"use client";

import { useQuery } from "@tanstack/react-query";
import {
  useConnectionStore,
  selectActiveInstance,
  isHttpApiConnection,
} from "@/store/connection";
import { fetchBudgetPreferences } from "@/lib/api/preferences";
import type { BudgetPreferences } from "@/lib/api/preferences";

const REFETCH_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches budget-level preference key/value pairs from the `preferences` table
 * via ActualQL. Fires once on first use (per active connection), then refreshes
 * every 5 minutes so user-side setting changes are eventually reflected without
 * a page reload.
 *
 * TanStack Query deduplicates the request — multiple components calling this
 * hook share a single fetch and cache entry.
 *
 * Returns typed defaults when the query is still loading or the key is absent.
 */
export function useBudgetPreferences(): BudgetPreferences {
  const connection = useConnectionStore(selectActiveInstance);
  const httpConnection = isHttpApiConnection(connection) ? connection : null;

  const { data } = useQuery({
    queryKey: ["budgetPreferences", httpConnection?.id],
    queryFn: () => {
      if (!httpConnection) throw new Error("No active Classic connection");
      return fetchBudgetPreferences(httpConnection);
    },
    enabled: !!httpConnection,
    staleTime: REFETCH_INTERVAL,
    gcTime: REFETCH_INTERVAL * 2,
    refetchInterval: REFETCH_INTERVAL,
    refetchIntervalInBackground: false,
  });

  return data ?? { upcomingScheduledTransactionLength: 14, budgetMode: "envelope" };
}
