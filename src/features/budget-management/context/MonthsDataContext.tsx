"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import {
  budgetMonthDataQueryOptions,
  isMissingBudgetMonthError,
} from "../lib/monthDataQuery";
import { useBudgetMode } from "../hooks/useBudgetMode";
import { useIncomeBudgets } from "../hooks/useIncomeBudgets";
import {
  computeEffectiveMonthState,
  mergeMonthStates,
  type MergedStructure,
} from "../lib/effectiveMonth";
import type { LoadedMonthState } from "../types";

// ─── Context shape ────────────────────────────────────────────────────────────

export type MonthsDataContextValue = {
  /** Raw server states keyed by month — shared TanStack Query cache. */
  raw: Map<string, LoadedMonthState>;
  /** Effective states (raw + cascade + income budgets + staged edits) per month. */
  effective: Map<string, LoadedMonthState>;
  /** Per-month errors when their query rejected. */
  errors: Map<string, unknown>;
  /** True while any in-window month is still loading initial data. */
  isLoading: boolean;
  /** Cross-month union of groups and categories, ordered by first appearance. */
  merged: MergedStructure | null;
};

const EMPTY_VALUE: MonthsDataContextValue = {
  raw: new Map(),
  effective: new Map(),
  errors: new Map(),
  isLoading: false,
  merged: null,
};

const MonthsDataContext = createContext<MonthsDataContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

type ProviderProps = {
  /** Visible month window (chronological order). */
  months: string[];
  /** Months the API reports as existing; unavailable months are skipped. */
  availableMonths?: string[];
  children: ReactNode;
};

/**
 * Loads every month in `months` via a single useQueries (replaces the two
 * 12-hook loaders) and computes the effective state per month with one shared
 * cascade pass and one shared edits subscription.
 *
 * Distributes the result via React Context so per-cell components can read
 * effective data without each subscribing to the full edits map.
 */
export function MonthsDataProvider({
  months,
  availableMonths,
  children,
}: ProviderProps) {
  const connection = useConnectionStore(selectActiveInstance);
  const { data: budgetMode } = useBudgetMode();
  const isTracking = budgetMode === "tracking";
  const loadableMonths = availableMonths ?? months;
  const loadableMonthSet = useMemo(
    () => new Set(loadableMonths),
    [loadableMonths]
  );

  const queries = useQueries({
    queries: months.map((m) => ({
      ...budgetMonthDataQueryOptions(connection, m),
      enabled: !!connection && !!m && loadableMonthSet.has(m),
    })),
  });

  // Snapshot only loadable month results. Disabled TanStack Query entries can
  // still expose cached data, so unavailable months must be filtered here.
  const dataArr = queries.map((q, i) =>
    loadableMonthSet.has(months[i]!) ? q.data : undefined
  );
  const errorArr = queries.map((q, i) =>
    loadableMonthSet.has(months[i]!) ? q.error : null
  );
  const isLoading = queries.some(
    (q, i) => loadableMonthSet.has(months[i]!) && q.isLoading
  );

  // Income category IDs — read from any loaded month (consistent across months).
  const incomeCategoryIds = useMemo(() => {
    for (const d of dataArr) {
      if (d) {
        return Object.values(d.categoriesById)
          .filter((c) => c.isIncome)
          .map((c) => c.id);
      }
    }
    return [];
    // dataArr is a fresh array each render but its element identities are stable
    // when underlying TanStack Query data is unchanged. Spread is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dataArr);

  const { data: incomeBudgets } = useIncomeBudgets(incomeCategoryIds, isTracking);

  // Single subscription to the entire edits map and holds map happens here,
  // ONCE for the whole grid — instead of once per cell as in pre-BM-02.
  const allEdits = useBudgetEditsStore((s) => s.edits);
  const allHolds = useBudgetEditsStore((s) => s.holds);

  const value = useMemo<MonthsDataContextValue>(() => {
    const raw = new Map<string, LoadedMonthState>();
    const effective = new Map<string, LoadedMonthState>();
    const errors = new Map<string, unknown>();

    for (let i = 0; i < months.length; i++) {
      const m = months[i]!;
      if (!loadableMonthSet.has(m)) continue;
      const data = dataArr[i];
      const err = errorArr[i];
      if (err && !isMissingBudgetMonthError(err, m)) errors.set(m, err);
      if (data) {
        raw.set(m, data);
        const eff = computeEffectiveMonthState({
          serverState: data,
          allEdits,
          isTracking,
          incomeBudgets,
          month: m,
          stagedHolds: allHolds,
        });
        if (eff) effective.set(m, eff);
      }
    }

    const merged = mergeMonthStates(dataArr);

    return { raw, effective, errors, isLoading, merged };
    // Spread data and error arrays so the memo recomputes only when an
    // underlying query result reference changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, loadableMonthSet, allEdits, allHolds, isTracking, incomeBudgets, isLoading, ...dataArr, ...errorArr]);

  return (
    <MonthsDataContext.Provider value={value}>
      {children}
    </MonthsDataContext.Provider>
  );
}

// ─── Consumers ────────────────────────────────────────────────────────────────

/** Reads the full context value. Returns the empty value when no provider is mounted. */
export function useMonthsData(): MonthsDataContextValue {
  return useContext(MonthsDataContext) ?? EMPTY_VALUE;
}

/**
 * Returns the raw context value, or null when no provider is mounted.
 *
 * Used by `useMonthData` to detect provider presence so it can either read
 * from context or fall back to a standalone TanStack Query subscription.
 */
export function useMonthsDataContext(): MonthsDataContextValue | null {
  return useContext(MonthsDataContext);
}

/**
 * Returns the precomputed effective state for `month` from context, or
 * undefined when no provider is mounted or the month isn't in the window.
 *
 * Per-cell components (`BudgetCell`, group aggregates, summary cells) should
 * use this hook — it makes only one cheap context read with NO subscription
 * to the edits map. Re-renders are driven solely by context value updates,
 * which the provider memoizes against actual data changes.
 */
export function useEffectiveMonthFromContext(
  month: string | null | undefined
): LoadedMonthState | undefined {
  const ctx = useContext(MonthsDataContext);
  if (!ctx || !month) return undefined;
  return ctx.effective.get(month);
}

/** Same as above but for raw server state. */
export function useRawMonthFromContext(
  month: string | null | undefined
): LoadedMonthState | undefined {
  const ctx = useContext(MonthsDataContext);
  if (!ctx || !month) return undefined;
  return ctx.raw.get(month);
}
