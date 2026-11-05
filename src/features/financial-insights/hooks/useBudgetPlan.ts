"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { useAvailableMonths } from "@/features/budget-management/hooks/useAvailableMonths";
import { useBudgetMode } from "@/features/budget-management/hooks/useBudgetMode";
import { ensureMonthsData } from "@/features/budget-management/lib/ensureMonthsData";
import { budgetMonthDataQueryOptions } from "@/features/budget-management/lib/monthDataQuery";
import type { LoadedMonthState } from "@/features/budget-management/types";
import { buildBudgetPlan, type BudgetPlan, type MonthRead, type PlanMode } from "@/lib/financial-insights/budget";
import type { ReadyData } from "./useFinancialInsights";

/**
 * Whether My budget has anything to show: the budget's mode is known (Tracking or Envelope) and Actual returned its latest month.
 * One month read, which Budget Cockpit shares through the same cache key, so the tab can be offered without reading the period.
 */
export function useBudgetAvailability(enabled: boolean, today: string): { mode: PlanMode | null; available: boolean } {
  const connection = useConnectionStore(selectActiveInstance);
  const modeQuery = useBudgetMode();
  const months = useAvailableMonths();
  const mode = modeQuery.data === "tracking" || modeQuery.data === "envelope" ? modeQuery.data : null;
  const current = today.slice(0, 7);
  const probeMonth = months.data ? ([...months.data].filter((m) => m <= current).pop() ?? null) : null;
  const probe = useQuery({ ...budgetMonthDataQueryOptions(connection, probeMonth), enabled: enabled && !!connection && !!probeMonth && mode !== null });
  return { mode, available: enabled && mode !== null && probe.isSuccess };
}

export type BudgetPlanLoad =
  | { state: "loading"; done: number; total: number }
  | { state: "error"; retry: () => void }
  | { state: "ready"; plan: BudgetPlan };

/**
 * Reads every budget month of the period when My budget opens, through the same query and cache as Budget Cockpit (a month
 * already open there is not read again), one month at a time like every other read on this page. It adds nothing to the main
 * read, so the other tabs never wait for it.
 */
export function useBudgetPlan(data: ReadyData, today: string, mode: PlanMode): BudgetPlanLoad {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  const available = useAvailableMonths();
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // Every month of the period, however long: a longer period reads more months, one at a time, and says which it is on.
  const months = data.period.months;
  const query = useQuery({
    queryKey: ["financial-insights", "budget-plan", connection?.id, connection?.budgetSyncId, today, months[0], months[months.length - 1]],
    // If the budget's month list cannot be read, every month is tried and a missing one is reported as unreadable.
    enabled: !!connection && !available.isLoading,
    queryFn: async (): Promise<MonthRead[]> => {
      const reads: MonthRead[] = [];
      for (const [i, month] of months.entries()) {
        setProgress({ done: i, total: months.length });
        const key = budgetMonthDataQueryOptions(connection, month).queryKey;
        // A month marked out of date (Refresh) is read again; one that is merely cached is used as it is.
        let refreshFailed = false;
        if (queryClient.getQueryState(key)?.isInvalidated) {
          await queryClient.refetchQueries({ queryKey: key, exact: true });
          // The refresh did not work: the month is not read, whatever an earlier read left in the cache.
          refreshFailed = queryClient.getQueryState(key)?.status === "error";
        }
        const result = await ensureMonthsData(queryClient, connection, [month], available.data);
        const state = queryClient.getQueryData<LoadedMonthState>(key);
        if (result.unavailable.length > 0) reads.push({ month, status: "unavailable" });
        else if (refreshFailed || result.failed.length > 0 || !state) reads.push({ month, status: "failed" });
        else reads.push({ month, status: "ok", state });
      }
      setProgress({ done: months.length, total: months.length });
      return reads;
    },
  });
  const plan = useMemo(
    () => (query.data ? buildBudgetPlan({ mode, reads: query.data, today, ledger: data.ledger, breakdown: data.breakdown }) : null),
    [query.data, mode, today, data.ledger, data.breakdown],
  );
  if (query.isError) return { state: "error", retry: () => void query.refetch() };
  if (!plan) return { state: "loading", done: progress.done, total: progress.total || months.length };
  return { state: "ready", plan };
}
