"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { budgetMonthDataQueryOptions } from "../lib/monthDataQuery";
import type { LoadedMonthState } from "../types";

/**
 * Month states for an arbitrary set of months, fetched by whoever needs them.
 *
 * The budget details panel loads the twelve months it is displaying and passes
 * that map down to everything beneath it. That works for components that only
 * ever describe the visible window, and fails for anything that can range
 * outside it: the spending dialog can be pointed at any period, and borrowing
 * the page's snapshot meant its budget figures were bounded by where someone
 * had last navigated rather than by what the budget file holds. The picker had
 * to be clamped to the same window to stop it offering months whose plan could
 * not be read - so a question about last year could not be asked at all, even
 * though the data was sitting in the query cache.
 *
 * A component that fetches its own states has no such boundary. The range it
 * can show and the range it can account for are the same set by construction,
 * because asking for a month is what loads it.
 *
 * Every month goes through `budgetMonthDataQueryOptions`, the same cached query
 * the page uses, so months already loaded or prefetched resolve without a
 * request.
 */
export function useBudgetMonthStates(
  months: string[],
  /**
   * Months the budget file actually has, from `useAvailableMonths`.
   *
   * A window can reach past either end of a budget - a year view of a file that
   * starts in March asks for January and February too - and those months answer
   * 404. Skipping them keeps an expected gap from being fetched and failing on
   * every render.
   */
  availableMonths: string[] | undefined
): {
  statesByMonth: Map<string, LoadedMonthState>;
  isLoading: boolean;
} {
  const connection = useConnectionStore(selectActiveInstance);
  const availableSet = useMemo(
    () => (availableMonths ? new Set(availableMonths) : null),
    [availableMonths]
  );

  const queries = useQueries({
    queries: months.map((month) => ({
      ...budgetMonthDataQueryOptions(connection, month),
      // Without the available list yet, nothing is fetched rather than every
      // month being fetched blindly - the list arrives in a moment and the
      // months it permits load then.
      enabled: !!connection && !!month && !!availableSet?.has(month),
      // Long enough that paging a range back and forth reads from cache, short
      // enough that an edit made on the page behind is picked up on reopen.
      staleTime: 2 * 60 * 1000,
    })),
  });

  const statesByMonth = useMemo(() => {
    const map = new Map<string, LoadedMonthState>();
    queries.forEach((query, index) => {
      const month = months[index];
      if (month && query.data) map.set(month, query.data);
    });
    return map;
    // `queries` is a new array each render; the data inside it is what matters,
    // and that changes only when a month resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, queries.map((query) => query.dataUpdatedAt).join(",")]);

  return {
    statesByMonth,
    isLoading: queries.some((query) => query.isLoading),
  };
}
