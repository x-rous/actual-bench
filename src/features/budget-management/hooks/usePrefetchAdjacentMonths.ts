"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { addMonths } from "@/lib/budget/monthMath";
import { budgetMonthDataQueryOptions } from "./useMonthData";

type Props = {
  windowStart: string;
  availableMonths: string[] | undefined;
};

/**
 * Warms the TanStack Query cache for the 12 months immediately before and
 * after the current 12-month window. Fires as a background side-effect so
 * that «/» navigation renders from cache without a loading state.
 *
 * prefetchQuery is a no-op if the data is already fresh — safe to call on
 * every windowStart change. staleTime of 2 minutes keeps prefetched months
 * fresh across typical month-by-month navigation so repeated adjacent-window
 * shifts don't trigger redundant network requests. Saves and carryover toggles
 * explicitly invalidate affected query keys, so stale data is never silently
 * retained after a write.
 */
export function usePrefetchAdjacentMonths({ windowStart, availableMonths }: Props) {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!connection || !availableMonths || availableMonths.length === 0) return;

    const availableSet = new Set(availableMonths);

    // prev window: windowStart − 12 to windowStart − 1
    // next window: windowStart + 12 to windowStart + 23
    const monthsToPrefetch: string[] = [];
    for (let i = -12; i <= -1; i++) {
      monthsToPrefetch.push(addMonths(windowStart, i));
    }
    for (let i = 12; i <= 23; i++) {
      monthsToPrefetch.push(addMonths(windowStart, i));
    }

    for (const month of monthsToPrefetch) {
      if (!availableSet.has(month)) continue;
      queryClient.prefetchQuery({
        ...budgetMonthDataQueryOptions(connection, month),
        staleTime: 2 * 60 * 1000, // 2 min — keeps prefetched months fresh across navigation
      });
    }
  }, [windowStart, availableMonths, connection, queryClient]);
}
