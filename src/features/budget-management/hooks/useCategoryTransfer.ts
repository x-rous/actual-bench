// Direct-API helper retained for RD-024v2 (Test Data Generator).
// The UI transfer flow uses useStagedTransfer instead.
// Do not wire this hook to any UI component.
"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { apiRequest } from "@/lib/api/client";
import type { CategoryTransferInput } from "../types";

type UseCategoryTransferReturn = {
  transfer: (month: string, input: CategoryTransferInput) => Promise<void>;
  isPending: boolean;
  error: string | null;
};

/**
 * Envelope-mode: immediate category-to-category budget transfer.
 *
 * Calls POST /months/{month}/categorytransfers directly — bypasses the staged
 * edits pipeline. On success, invalidates the affected month's TanStack Query
 * cache so the grid reloads with the updated balances.
 *
 * This is an immediate action: it takes effect at the time the user confirms.
 * It does not go through the staged save panel.
 */
export function useCategoryTransfer(): UseCategoryTransferReturn {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transfer = useCallback(
    async (month: string, input: CategoryTransferInput): Promise<void> => {
      if (!connection) throw new Error("No active connection");

      setIsPending(true);
      setError(null);

      try {
        await apiRequest(connection, `/months/${month}/categorytransfers`, {
          method: "POST",
          body: {
            amount: input.amount,
            categoryId: input.fromCategoryId,
            transferCategoryId: input.toCategoryId,
          },
        });

        await queryClient.invalidateQueries({
          queryKey: ["budget-month-data", connection.id, month],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Transfer failed";
        setError(message);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [connection, queryClient]
  );

  return { transfer, isPending, error };
}
