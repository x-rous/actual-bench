"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { budgetMonthDataQueryOptions } from "../lib/monthDataQuery";
import { useMonthsDataContext } from "../context/MonthsDataContext";
import type { LoadedMonthState } from "../types";

// Re-export for callers that imported it from this module historically.
export { budgetMonthDataQueryOptions };

/**
 * Reads a single month's budget data.
 *
 * If a `MonthsDataProvider` is mounted upstream and the requested month is in
 * its window, this hook reads the cached value via context — avoiding a
 * per-cell TanStack Query subscription.
 *
 * For months outside the provider window (e.g. previous-month lookups in the
 * draft panel), or when no provider is mounted, falls back to a standalone
 * TanStack Query subscription. Query key is identical so cache hits are shared.
 */
export function useMonthData(month: string | null | undefined): {
  data: LoadedMonthState | undefined;
  isLoading: boolean;
  error: unknown;
} {
  const ctx = useMonthsDataContext();
  const fromContext = ctx && month ? ctx.raw.get(month) : undefined;
  const inContext = !!fromContext;

  const connection = useConnectionStore(selectActiveInstance);
  const query = useQuery({
    ...budgetMonthDataQueryOptions(connection, month),
    enabled: !inContext && !!connection && !!month,
  });

  if (inContext) {
    return {
      data: fromContext,
      isLoading: false,
      error: ctx?.errors.get(month!) ?? null,
    };
  }
  return { data: query.data, isLoading: query.isLoading, error: query.error };
}
