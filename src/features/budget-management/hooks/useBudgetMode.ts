"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { runQuery } from "@/lib/api/query";
import {
  ZERO_BUDGET_COUNT_QUERY,
  REFLECT_BUDGET_COUNT_QUERY,
} from "@/lib/budget/budgetModeQueries";
import { deriveBudgetMode } from "@/lib/budget/deriveBudgetMode";
import type { BudgetMode as DerivedBudgetMode } from "@/features/overview/types";
import type { BudgetMode } from "../types";

const MODE_MAP: Record<DerivedBudgetMode, BudgetMode> = {
  Envelope: "envelope",
  Tracking: "tracking",
  Unidentified: "unidentified",
};

/**
 * Reads the budget mode by running ActualQL queries against zero_budgets and
 * reflect_budgets tables. Normalizes the result to lowercase BudgetMode as
 * used within the budget-management feature.
 */
export function useBudgetMode(): {
  data: BudgetMode | undefined;
  isLoading: boolean;
  error: unknown;
} {
  const connection = useConnectionStore(selectActiveInstance);

  const query = useQuery({
    queryKey: ["budget-mode", connection?.id],
    queryFn: async () => {
      if (!connection) throw new Error("No active connection");

      const [zeroResult, reflectResult] = await Promise.all([
        runQuery<{ data: number }>(connection, ZERO_BUDGET_COUNT_QUERY),
        runQuery<{ data: number }>(connection, REFLECT_BUDGET_COUNT_QUERY),
      ]);

      // Exhaustive map keyed by the source's union type — no fallback needed.
      return MODE_MAP[deriveBudgetMode(zeroResult.data, reflectResult.data)];
    },
    enabled: !!connection,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}
