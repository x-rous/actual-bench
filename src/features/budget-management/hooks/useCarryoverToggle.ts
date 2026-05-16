"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { apiRequest } from "@/lib/api/client";
import { addMonths } from "@/lib/budget/monthMath";

export type CarryoverToggleInput = {
  categoryId: string;
  /** Months to update, in chronological order. */
  months: string[];
  /** The carryover value to set on every month. */
  newValue: boolean;
};

export type CarryoverToggleResult = {
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
 * Toggles the carryover (rollover) flag on a category across multiple months.
 *
 * PATCHes are issued sequentially because the proxy serializes per-budget
 * writes anyway — running them in parallel would queue at the proxy and risk
 * obscure ordering bugs. Cache invalidations after the loop are parallelized
 * because they are read-side and independent.
 *
 * Per-month failures are surfaced in the returned results so the calling
 * dialog can show partial success and offer a retry on the failed months only.
 */
export function useCarryoverToggle(): UseCarryoverToggleReturn {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();

  const [isPending, setIsPending] = useState(false);
  const [progress, setProgress] = useState<Progress>({ completed: 0, total: 0 });

  const run = useCallback(
    async (input: CarryoverToggleInput): Promise<CarryoverToggleResult[]> => {
      if (!connection) throw new Error("No active connection");
      if (input.months.length === 0) return [];

      setIsPending(true);
      setProgress({ completed: 0, total: input.months.length });

      const results: CarryoverToggleResult[] = [];
      const successMonths: string[] = [];

      for (let i = 0; i < input.months.length; i++) {
        const m = input.months[i]!;
        try {
          await apiRequest(
            connection,
            `/months/${m}/categories/${input.categoryId}`,
            {
              method: "PATCH",
              body: { category: { carryover: input.newValue } },
            }
          );
          successMonths.push(m);
          results.push({ month: m, status: "success" });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Carryover update failed";
          results.push({ month: m, status: "error", message });
        }
        setProgress({ completed: i + 1, total: input.months.length });
      }

      if (successMonths.length > 0) {
        await Promise.all(
          successMonths.map((m) =>
            queryClient.invalidateQueries({
              queryKey: ["budget-month-data", connection.id, m],
            })
          )
        );

        // RD-038: Invalidate adjacent prefetched windows so any pre-warmed months
        // reflect the updated carryover flag and compute the correct per-category
        // balance cascade in tracking mode.
        const firstMonth = input.months[0]!;
        const lastMonth = input.months[input.months.length - 1]!;
        const adjacentMonths: string[] = [];
        for (let i = -12; i <= -1; i++) adjacentMonths.push(addMonths(firstMonth, i));
        for (let i = 1; i <= 12; i++) adjacentMonths.push(addMonths(lastMonth, i));
        await Promise.all(
          adjacentMonths.map((month) =>
            queryClient.invalidateQueries({
              queryKey: ["budget-month-data", connection.id, month],
            })
          )
        );
      }

      setIsPending(false);
      setProgress({ completed: 0, total: 0 });

      return results;
    },
    [connection, queryClient]
  );

  return { run, isPending, progress };
}
