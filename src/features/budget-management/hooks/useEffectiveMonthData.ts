"use client";

import { useMemo } from "react";
import { useMonthData } from "./useMonthData";
import { useIncomeBudgets } from "./useIncomeBudgets";
import { useBudgetMode } from "./useBudgetMode";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { computeEffectiveMonthState } from "../lib/effectiveMonth";
import type { LoadedMonthState } from "../types";

/**
 * Standalone effective-month resolver.
 *
 * Subscribes to the full edits map and recomputes the cascade per call. This
 * is the **fallback path** — performance-critical per-cell components should
 * read from `MonthsDataProvider` via `useEffectiveMonthFromContext` instead,
 * which does the cascade once for the whole grid.
 *
 * This hook remains for callers operating on months outside the provider's
 * window (e.g. previous-month lookups in the draft panel) where the context
 * map has no entry. The cascade math itself is delegated to
 * `computeEffectiveMonthState` for testability.
 *
 * Returns undefined data while loading or when month is null.
 */
export function useEffectiveMonthData(month: string | null | undefined): {
  data: LoadedMonthState | undefined;
  isLoading: boolean;
  error: unknown;
} {
  const { data: serverState, isLoading: monthLoading, error } = useMonthData(month);
  const { data: budgetMode } = useBudgetMode();
  const isTracking = budgetMode === "tracking";

  const incomeCategoryIds = useMemo(
    () =>
      serverState
        ? Object.values(serverState.categoriesById)
            .filter((c) => c.isIncome)
            .map((c) => c.id)
        : [],
    [serverState]
  );

  const {
    data: allIncomeBudgets,
    isLoading: incomeBudgetsLoading,
    error: incomeBudgetsError,
  } = useIncomeBudgets(incomeCategoryIds, isTracking);

  const allEdits = useBudgetEditsStore((s) => s.edits);

  const data = useMemo<LoadedMonthState | undefined>(
    () =>
      computeEffectiveMonthState({
        serverState,
        allEdits,
        isTracking,
        incomeBudgets: allIncomeBudgets,
        month: month ?? "",
      }),
    [serverState, allEdits, isTracking, allIncomeBudgets, month]
  );

  const isLoading = monthLoading || (isTracking && incomeBudgetsLoading);
  const effectiveError =
    error ?? (isTracking && incomeBudgetsError ? incomeBudgetsError : null);

  return { data, isLoading, error: effectiveError };
}
