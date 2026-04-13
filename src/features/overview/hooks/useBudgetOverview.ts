"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import type {
  BudgetOverviewSnapshot,
  OverviewRefreshResult,
  UseBudgetOverviewResult,
} from "../types";
import { fetchAllOverviewStats } from "../lib/overviewQueries";

function hasPartialFailure(snapshot: BudgetOverviewSnapshot | null | undefined): boolean {
  if (!snapshot) return false;

  return (
    snapshot.budgetMode === null ||
    snapshot.budgetingSince === null ||
    Object.values(snapshot.stats).some((value) => value === null)
  );
}

export function useBudgetOverview(): UseBudgetOverviewResult {
  const connection = useConnectionStore(selectActiveInstance);

  const query = useQuery({
    queryKey: ["budget-overview", connection?.id],
    queryFn: () => fetchAllOverviewStats(connection!),
    enabled: !!connection,
  });

  const snapshot = query.data ?? null;
  const snapshotHasPartialFailure = hasPartialFailure(snapshot);

  return {
    snapshot,
    isLoading: query.isLoading,
    isError: query.isError,
    hasPartialFailure: snapshotHasPartialFailure,
    refresh: async (): Promise<OverviewRefreshResult> => {
      const result = await query.refetch();
      const refreshedSnapshot = result.data ?? null;
      const refreshedHasPartialFailure = hasPartialFailure(refreshedSnapshot);

      return {
        ok: !result.error && !!refreshedSnapshot && !refreshedHasPartialFailure,
        hasPartialFailure: refreshedHasPartialFailure,
      };
    },
  };
}
