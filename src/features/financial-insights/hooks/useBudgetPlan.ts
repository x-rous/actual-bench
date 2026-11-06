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
 * Months read at once. The proxy still sends them to actual-http-api one at a time (see `serverQueue.ts`: the backend must
 * never see two requests together), so this does not add concurrency there. It keeps the next requests already on their way
 * while one is being served, which is most of the time a month takes: 86 months read in about 40s one after another and in
 * about 12s four at a time (measured against the demo, 2026-11). Not configurable, on purpose.
 */
const MONTHS_AT_ONCE = 4;

/**
 * Reads every budget month of the period when My budget opens, through the same query and cache as Budget Cockpit (a month
 * already open there is not read again), a few months in flight at a time. It adds nothing to the main read, so the other
 * tabs never wait for it.
 */
export function useBudgetPlan(data: ReadyData, today: string, mode: PlanMode): BudgetPlanLoad {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  const available = useAvailableMonths();
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // Every month of the period, however long: a longer period reads more months, a few at a time, and says how far it is.
  const months = data.period.months;
  const query = useQuery({
    queryKey: ["financial-insights", "budget-plan", connection?.id, connection?.budgetSyncId, today, months[0], months[months.length - 1]],
    // If the budget's month list cannot be read, every month is tried and a missing one is reported as unreadable.
    enabled: !!connection && !available.isLoading,
    queryFn: async (): Promise<MonthRead[]> => {
      let finished = 0;
      const readMonth = async (month: string): Promise<MonthRead> => {
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
        setProgress({ done: ++finished, total: months.length });
        if (result.unavailable.length > 0) return { month, status: "unavailable" };
        if (refreshFailed || result.failed.length > 0 || !state) return { month, status: "failed" };
        return { month, status: "ok", state };
      };
      setProgress({ done: 0, total: months.length });
      const reads: MonthRead[] = [];
      // In period order: a batch settles before the next starts, and its results keep the order they were asked in.
      for (let i = 0; i < months.length; i += MONTHS_AT_ONCE) reads.push(...(await Promise.all(months.slice(i, i + MONTHS_AT_ONCE).map(readMonth))));
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
