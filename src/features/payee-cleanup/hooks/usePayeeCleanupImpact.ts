"use client";

import { useMemo } from "react";
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
): ImpactSources {
  useRules({ enabled: options.enabled });
  useSchedules({ enabled: options.enabled });

  const stagedRules = useStagedStore((s) => s.rules);
  const stagedSchedules = useStagedStore((s) => s.schedules);

  const payeeIds = useMemo(() => candidates.map((c) => c.id), [candidates]);

  const { data: transactionCounts, isLoading } = useTransactionCountsForIds(
    "payee",
    payeeIds,
    { enabled: options.enabled && payeeIds.length > 0 }
  );

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
      transactionCounts,
      transactionsLoading: isLoading,
    }),
    [stagedRules, schedules, transactionCounts, isLoading]
  );
}
