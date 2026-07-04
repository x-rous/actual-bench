"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { getTransport } from "@/lib/actual";

/**
 * Fetches the list of available months from GET /months.
 * Returns months sorted ascending (oldest first).
 */
export function useAvailableMonths(): {
  data: string[] | undefined;
  isLoading: boolean;
  error: unknown;
} {
  const connection = useConnectionStore(selectActiveInstance);

  const query = useQuery({
    queryKey: ["budget-months", connection?.id],
    queryFn: async () => {
      if (!connection) throw new Error("No active connection");
      const months = await getTransport(connection).getBudgetMonths();
      return [...months].sort();
    },
    enabled: !!connection,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}
