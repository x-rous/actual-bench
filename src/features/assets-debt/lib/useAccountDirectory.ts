"use client";

import { useQuery } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import { readAccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";

/**
 * The connected budget's accounts and categories, read through the Assets &
 * Debt ledger port (read-only). The editor validates against it and sends it
 * with a save; nothing here can write to Actual.
 */
export function useAccountDirectory() {
  const connection = useConnectionStore(selectActiveInstance);
  return useQuery({
    queryKey: ["assets-debt", "account-directory", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return readAccountDirectory(getTransport(connection), connection.budgetSyncId);
    },
    enabled: !!connection,
  });
}

export function useActiveBudgetSyncId(): string | null {
  return useConnectionStore(selectActiveInstance)?.budgetSyncId ?? null;
}
