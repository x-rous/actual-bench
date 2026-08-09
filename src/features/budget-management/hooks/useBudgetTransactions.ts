"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import {
  fetchBudgetTransactions,
  fetchBudgetTransactionsSummary,
  type BudgetTransactionRow,
  type BudgetTransactionsSummary,
} from "../lib/budgetTransactionsQuery";

type UseBudgetTransactionsInput = {
  month: string;
  categoryIds: string[];
  enabled: boolean;
};

export type BudgetTransactionsResult = {
  /** The fetched page of rows (capped at the row limit). */
  rows: BudgetTransactionRow[];
  /** True aggregate over the whole matching set, or null if unavailable. */
  summary: BudgetTransactionsSummary | null;
};

export function useBudgetTransactions({
  month,
  categoryIds,
  enabled,
}: UseBudgetTransactionsInput): {
  data: BudgetTransactionsResult | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
} {
  const connection = useConnectionStore(selectActiveInstance);
  const sortedCategoryIds = useMemo(
    () => [...categoryIds].sort(),
    [categoryIds]
  );

  const query = useQuery({
    queryKey: [
      "budget-transactions",
      connection?.id,
      month,
      sortedCategoryIds.join(","),
    ],
    queryFn: async (): Promise<BudgetTransactionsResult> => {
      if (!connection) throw new Error("No active connection");
      const params = { month, categoryIds: sortedCategoryIds };
      // The row page must succeed; the aggregate is best-effort so a transport
      // that can't run aggregate selects degrades to a truncation notice rather
      // than failing the whole drill-down (BM-05).
      const [rows, summary] = await Promise.all([
        fetchBudgetTransactions(connection, params),
        fetchBudgetTransactionsSummary(connection, params).catch(() => null),
      ]);
      return { rows, summary };
    },
    enabled:
      enabled &&
      !!connection &&
      month.length > 0 &&
      sortedCategoryIds.length > 0,
    staleTime: 60 * 1000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}
