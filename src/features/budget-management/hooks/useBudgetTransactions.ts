"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import {
  fetchBudgetTransactions,
  type BudgetTransactionRow,
} from "../lib/budgetTransactionsQuery";

type UseBudgetTransactionsInput = {
  month: string;
  categoryIds: string[];
  enabled: boolean;
};

export function useBudgetTransactions({
  month,
  categoryIds,
  enabled,
}: UseBudgetTransactionsInput): {
  data: BudgetTransactionRow[] | undefined;
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
    queryFn: async () => {
      if (!connection) throw new Error("No active connection");
      return fetchBudgetTransactions(connection, {
        month,
        categoryIds: sortedCategoryIds,
      });
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
