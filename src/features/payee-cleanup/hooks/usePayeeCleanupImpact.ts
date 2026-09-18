"use client";

import { useCallback, useMemo } from "react";
import { useStagedStore } from "@/store/staged";
import { useRules } from "@/features/rules/hooks/useRules";
import { useAllTransactionCounts } from "@/hooks/useTransactionCountsForIds";
import type { ImpactSources } from "../lib/impact";

/**
 * Loads the whole-budget inputs shared by every cleanup result: transaction
 * counts per payee and the rule set.
 *
 * Rules come from the shared staged store, so cleanup sees the same working set
 * as the rest of the app — including edits the user has staged but not saved,
 * which is exactly what should inform a merge or deletion decision.
 *
 * The transaction query groups the whole transaction table by payee. This
 * avoids serializing every eligible payee id into a large `$oneof` filter while
 * still letting the scan distinguish used payees from true zero-count payees.
 */
export function usePayeeCleanupImpact(
  options: { enabled: boolean }
): ImpactSources & {
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const rulesQuery = useRules({ enabled: options.enabled });

  const stagedRules = useStagedStore((s) => s.rules);
  const transactionQuery = useAllTransactionCounts("payee", {
    enabled: options.enabled,
  });

  const refetchRules = rulesQuery.refetch;
  const refetchTransactions = transactionQuery.refetch;

  const refetch = useCallback(() => {
    void Promise.all([refetchRules(), refetchTransactions()]);
  }, [refetchRules, refetchTransactions]);

  // Memoized because the scan keys off this object. Returning a fresh literal
  // re-ran detection, corpus learning, clustering and scoring on every render —
  // including every keystroke in the search box.
  return useMemo(
    () => ({
      stagedRules,
      transactionCounts: transactionQuery.data,
      transactionsLoading: transactionQuery.isLoading,
      isLoading: rulesQuery.isLoading || transactionQuery.isLoading,
      isFetching: rulesQuery.isFetching || transactionQuery.isFetching,
      error: rulesQuery.error ?? transactionQuery.error,
      refetch,
    }),
    [
      stagedRules,
      transactionQuery.data,
      transactionQuery.isLoading,
      transactionQuery.isFetching,
      transactionQuery.error,
      rulesQuery.isLoading,
      rulesQuery.isFetching,
      rulesQuery.error,
      refetch,
    ]
  );
}
