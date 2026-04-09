"use client";

import { useQuery } from "@tanstack/react-query";
import { getAccountBalances } from "@/lib/api/accounts";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";

/**
 * Fetches current balances for all accounts via a single ActualQL query.
 * Returns a Map<accountId, balance> where balance is in whole currency units.
 *
 * staleTime is intentionally set to 60s (not the global Infinity) because
 * balances change with every transaction.
 *
 * This hook is shared by AccountsTable (display) and RD-016 (close warning).
 */
export function useAccountBalances() {
  const connection = useConnectionStore(selectActiveInstance);

  return useQuery({
    queryKey: ["accountBalances", connection?.budgetSyncId],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getAccountBalances(connection);
    },
    enabled: !!connection,
    staleTime: 60_000,
  });
}
