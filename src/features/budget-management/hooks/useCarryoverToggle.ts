"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { getTransport } from "@/lib/actual";

export type CarryoverToggleInput = {
  categoryIds: string[];
  /**
   * First month to change. Actual applies a rollover flag from this month
   * through every later month of the budget (`setCategoryCarryover` walks
   * `getAllMonths(startMonth)`), so one call per category covers them all.
   */
  fromMonth: string;
  /** The carryover value to set. */
  newValue: boolean;
};

export type CarryoverToggleResult = {
  categoryId: string;
  month: string;
  status: "success" | "error";
  message?: string;
};

type Progress = {
  completed: number;
  total: number;
};

type UseCarryoverToggleReturn = {
  run: (input: CarryoverToggleInput) => Promise<CarryoverToggleResult[]>;
  isPending: boolean;
  progress: Progress;
};

/**
 * Sets the carryover (rollover) flag on categories from `fromMonth` onward.
 *
 * H6: one request per category. Actual already writes the flag to every month
 * from `fromMonth` on, so sending one request per month repeated the same
 * forward write many times and made a bounded range impossible anyway.
 * Requests run one at a time, as the proxy serializes writes per budget.
 *
 * Per-category failures are surfaced in the returned results so the calling
 * dialog can show partial success and offer a retry on the failed ones only.
 */
export function useCarryoverToggle(): UseCarryoverToggleReturn {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();

  const [isPending, setIsPending] = useState(false);
  const [progress, setProgress] = useState<Progress>({ completed: 0, total: 0 });

  const run = useCallback(
    async (input: CarryoverToggleInput): Promise<CarryoverToggleResult[]> => {
      if (!connection) throw new Error("No active connection");
      if (!input.fromMonth || input.categoryIds.length === 0) return [];
      const transport = getTransport(connection);
      const month = input.fromMonth;
      const total = input.categoryIds.length;

      setIsPending(true);
      setProgress({ completed: 0, total });

      const results: CarryoverToggleResult[] = [];
      try {
        await transport.batchBudgetUpdates(async () => {
          for (let i = 0; i < input.categoryIds.length; i++) {
            const catId = input.categoryIds[i]!;
            try {
              await transport.setBudgetCarryover(month, catId, input.newValue);
              results.push({ categoryId: catId, month, status: "success" });
            } catch (err) {
              const message =
                err instanceof Error ? err.message : "Carryover update failed";
              results.push({ categoryId: catId, month, status: "error", message });
            }
            setProgress({ completed: i + 1, total });
          }
        });

        if (results.some((r) => r.status === "success")) {
          // The flag changed in every month from `month` on, so refresh every
          // cached month at or after it (as the budget save does, BM-10).
          // Earlier months are unaffected.
          await queryClient.invalidateQueries({
            predicate: (query) => {
              const key = query.queryKey;
              return (
                Array.isArray(key) &&
                key[0] === "budget-month-data" &&
                key[1] === connection.id &&
                typeof key[2] === "string" &&
                key[2] >= month
              );
            },
          });
        }
      } finally {
        setIsPending(false);
        setProgress({ completed: 0, total: 0 });
      }

      return results;
    },
    [connection, queryClient]
  );

  return { run, isPending, progress };
}
