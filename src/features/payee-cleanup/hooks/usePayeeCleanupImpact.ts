"use client";

import { useCallback, useMemo } from "react";
import { useStagedStore } from "@/store/staged";
import { useRules } from "@/features/rules/hooks/useRules";
import { useSchedules } from "@/features/schedules/hooks/useSchedules";
import { useTransactionCountsForIds } from "@/hooks/useTransactionCountsForIds";
import type { ImpactSources } from "../lib/impact";
import type { PayeeCleanupCandidate } from "../types";

/**
 * Loads everything the impact model needs: transaction counts per payee, the
 * rule set, and the schedules that tell schedule-linked rules from regular ones.
 *
 * Rules and schedules come from the shared staged store, so cleanup sees the
 * same working set as the rest of the app — including edits the user has staged
 * but not saved, which is exactly what should inform a merge decision.
 *
 * The transaction query is one `$oneof`-filtered ActualQL call for every
 * eligible payee, which works identically in both transports.
 */
export function usePayeeCleanupImpact(
  candidates: PayeeCleanupCandidate[],
  options: { enabled: boolean }
): ImpactSources & {
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const rulesQuery = useRules({ enabled: options.enabled });
  const schedulesQuery = useSchedules({ enabled: options.enabled });

  const stagedRules = useStagedStore((s) => s.rules);
  const stagedSchedules = useStagedStore((s) => s.schedules);

  const payeeIds = useMemo(() => candidates.map((c) => c.id), [candidates]);

  const transactionQuery = useTransactionCountsForIds("payee", payeeIds, {
    enabled: options.enabled && payeeIds.length > 0,
  });

  const refetchRules = rulesQuery.refetch;
  const refetchSchedules = schedulesQuery.refetch;
  const refetchTransactions = transactionQuery.refetch;

  const refetch = useCallback(() => {
    void Promise.all([
      refetchRules(),
      refetchSchedules(),
      ...(payeeIds.length > 0 ? [refetchTransactions()] : []),
    ]);
  }, [payeeIds.length, refetchRules, refetchSchedules, refetchTransactions]);

  const schedules = useMemo(
    () =>
      Object.values(stagedSchedules)
        .filter((s) => !s.isDeleted)
        .map((s) => s.entity),
    [stagedSchedules]
  );

  // Memoized because the scan keys off this object. Returning a fresh literal
  // re-ran detection, corpus learning, clustering and scoring on every render —
  // including every keystroke in the search box.
  return useMemo(
    () => ({
      stagedRules,
      schedules,
      transactionCounts: transactionQuery.data,
      transactionsLoading: transactionQuery.isLoading,
      isLoading:
        rulesQuery.isLoading ||
        schedulesQuery.isLoading ||
        transactionQuery.isLoading,
      isFetching:
        rulesQuery.isFetching ||
        schedulesQuery.isFetching ||
        transactionQuery.isFetching,
      error:
        rulesQuery.error ?? schedulesQuery.error ?? transactionQuery.error,
      refetch,
    }),
    [
      stagedRules,
      schedules,
      transactionQuery.data,
      transactionQuery.isLoading,
      transactionQuery.isFetching,
      transactionQuery.error,
      rulesQuery.isLoading,
      rulesQuery.isFetching,
      rulesQuery.error,
      schedulesQuery.isLoading,
      schedulesQuery.isFetching,
      schedulesQuery.error,
      refetch,
    ]
  );
}
