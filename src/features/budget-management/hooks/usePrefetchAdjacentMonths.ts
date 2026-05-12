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
 * prefetchQuery is a no-op if the data is already cached or a fetch is in
 * flight — safe to call on every windowStart change.
 *
 * staleTime is intentionally kept at 0 (the query default) so TanStack Query
 * fires a background refetch when the prefetched months become visible. Any
 * staleness from save or carryover toggle self-corrects within ~200–400ms.
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
      queryClient.prefetchQuery(budgetMonthDataQueryOptions(connection, month));
    }
  }, [windowStart, availableMonths, connection, queryClient]);
}
