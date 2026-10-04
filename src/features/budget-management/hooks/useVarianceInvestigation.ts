"use client";

import { useMemo } from "react";
import { monthsInRange } from "@/lib/budget/monthMath";
import {
  classifyMonthActualStatus,
  isActualLikeStatus,
  isClosedMonthStatus,
} from "../lib/budgetDetailsModel";
import {
  buildVarianceModel,
  chooseHistoryMonths,
  recentMonths,
  type VarianceLevel,
  type VarianceMode,
  type VarianceModel,
  type VarianceSide,
} from "../lib/varianceInvestigation";
import { applyIncomeBudgetFallback } from "../lib/varianceInvestigation/varianceIncomeBudgets";
import type { VarianceScope } from "../lib/varianceInvestigation/varianceScope";
import type { LoadedMonthState } from "../types";
import { useAvailableMonths } from "./useAvailableMonths";
import { useBudgetMonthStates } from "./useBudgetMonthStates";
import { useIncomeBudgets } from "./useIncomeBudgets";

export const isClosedMonth = (month: string): boolean =>
  isClosedMonthStatus(classifyMonthActualStatus(month));

type Args = {
  mode: VarianceMode;
  side: VarianceSide;
  monthStart: string;
  monthEnd: string;
  scope: VarianceScope;
  level: VarianceLevel | "auto";
};

export type VarianceInvestigation = {
  model: VarianceModel;
  /** The months the model covers: the period, less any that have not happened. */
  months: string[];
  /** The period reaches months with no actuals yet, which are left out. */
  hasFutureMonths: boolean;
  /** The period includes the current month, so figures are "so far". */
  provisional: boolean;
  /** The period is only closed months. */
  allClosed: boolean;
  /** Months that make up the recent-months view and pattern context. */
  contextMonths: string[];
  isLoading: boolean;
  error: unknown;
  /** The history behind "typical per month" is still loading. */
  historyLoading: boolean;
};

/**
 * Everything the Variance Drivers dialog needs from the budget file, loaded
 * from the monthly budget payload the rest of the workspace already uses.
 *
 * The period and the recent months load first. The months behind the
 * historical baseline load afterwards, from one set chosen up front, so the
 * dialog does not wait on them and does not fetch candidates it will not use.
 */
export function useVarianceInvestigation({
  mode,
  side,
  monthStart,
  monthEnd,
  scope,
  level,
}: Args): VarianceInvestigation {
  const { data: availableMonths, isLoading: monthsLoading } = useAvailableMonths();
  const available = useMemo(() => new Set(availableMonths ?? []), [availableMonths]);

  const periodMonths = useMemo(() => monthsInRange(monthStart, monthEnd), [monthStart, monthEnd]);
  const months = useMemo(
    () => periodMonths.filter((m) => isActualLikeStatus(classifyMonthActualStatus(m))),
    [periodMonths]
  );
  const provisional = useMemo(
    () => months.some((m) => classifyMonthActualStatus(m) === "current-partial"),
    [months]
  );

  // A short period is read against the months before it.
  const contextMonths = useMemo(
    () => (months.length > 0 && months.length < 3 ? recentMonths(months) : []),
    [months]
  );
  const primaryMonths = useMemo(
    () => [...new Set([...months, ...contextMonths])].sort(),
    [months, contextMonths]
  );
  const primary = useBudgetMonthStates(primaryMonths, availableMonths, monthsLoading);

  const historyMonths = useMemo(
    () =>
      primary.isLoading
        ? []
        : chooseHistoryMonths(months, available, isClosedMonth).filter(
            (m) => !primaryMonths.includes(m)
          ),
    [primary.isLoading, months, available, primaryMonths]
  );
  const history = useBudgetMonthStates(historyMonths, availableMonths, monthsLoading);

  const merged = useMemo(() => {
    const map = new Map<string, LoadedMonthState>(primary.statesByMonth);
    for (const [month, state] of history.statesByMonth) map.set(month, state);
    return map;
  }, [primary.statesByMonth, history.statesByMonth]);

  // Older servers leave income budgets out of the month payload.
  const wantsIncomeFallback = mode === "tracking" && side === "income";
  const fallbackIds = useMemo(() => {
    if (!wantsIncomeFallback) return [];
    const ids = new Set<string>();
    for (const state of merged.values()) {
      for (const id of state.incomeBudgetFallbackIds ?? []) ids.add(id);
    }
    return [...ids];
  }, [wantsIncomeFallback, merged]);
  const { data: incomeBudgets, isLoading: incomeBudgetsLoading } = useIncomeBudgets(
    fallbackIds,
    fallbackIds.length > 0
  );

  const statesByMonth = useMemo(() => {
    if (fallbackIds.length === 0) return merged;
    return new Map(
      [...merged].map(([month, state]) => [
        month,
        applyIncomeBudgetFallback(state, month, incomeBudgets),
      ])
    );
  }, [merged, fallbackIds, incomeBudgets]);

  const model = useMemo(
    () =>
      buildVarianceModel({
        mode,
        side,
        months,
        statesByMonth,
        categoryIds: scope.wholeSide ? null : scope.categoryIds,
        groupIds: scope.wholeSide ? null : scope.groupIds,
        level,
      }),
    [mode, side, months, statesByMonth, scope, level]
  );

  return {
    model,
    months,
    hasFutureMonths: months.length < periodMonths.length,
    provisional,
    allClosed: months.length > 0 && months.every(isClosedMonth),
    contextMonths,
    // The fallback budgets are part of the model: without them every income
    // category reads as unbudgeted until they arrive.
    isLoading: monthsLoading || primary.isLoading || (fallbackIds.length > 0 && incomeBudgetsLoading),
    error: primary.error,
    historyLoading: history.isLoading,
  };
}
