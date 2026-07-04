"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { getTransport, syncTransportAfterChanges } from "@/lib/actual";
import type { NextMonthHoldInput } from "../types";

type UseNextMonthHoldReturn = {
  setHold: (month: string, input: NextMonthHoldInput) => Promise<void>;
  clearHold: (month: string) => Promise<void>;
  isPending: boolean;
  error: string | null;
};

/**
 * Envelope-mode: immediate next-month budget hold management.
 *
 * setHold and clearHold route through the active transport. They bypass
 * the staged edits pipeline and take effect immediately on confirm.
 * Both invalidate the affected month's TanStack Query cache on success.
 */
export function useNextMonthHold(): UseNextMonthHoldReturn {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidateMonth = useCallback(
    async (month: string) => {
      if (!connection) return;
      await queryClient.invalidateQueries({
        queryKey: ["budget-month-data", connection.id, month],
      });
    },
    [connection, queryClient]
  );

  const setHold = useCallback(
    async (month: string, input: NextMonthHoldInput): Promise<void> => {
      if (!connection) throw new Error("No active connection");

      setIsPending(true);
      setError(null);

      try {
        const transport = getTransport(connection);
        await transport.holdBudgetForNextMonth(month, input.amount);
        await syncTransportAfterChanges(transport, true);
        await invalidateMonth(month);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to set hold";
        setError(message);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [connection, invalidateMonth]
  );

  const clearHold = useCallback(
    async (month: string): Promise<void> => {
      if (!connection) throw new Error("No active connection");

      setIsPending(true);
      setError(null);

      try {
        const transport = getTransport(connection);
        await transport.resetBudgetHold(month);
        await syncTransportAfterChanges(transport, true);
        await invalidateMonth(month);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to clear hold";
        setError(message);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [connection, invalidateMonth]
  );

  return { setHold, clearHold, isPending, error };
}
