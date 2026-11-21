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
 * P2: only months that are not cached, or that a write invalidated, are
 * requested. The query keeps the app-wide infinite stale time (AGENTS §5), so
 * `prefetchQuery` is a no-op for a cached month and is safe to call on every
 * windowStart change. An earlier 2-minute override made every pan after the
 * first two minutes reload up to 24 months through the serialized request
 * queue, ahead of any Save. Saves and carryover toggles invalidate every
 * month they change, so a skipped month is never stale.
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
      void queryClient.prefetchQuery(budgetMonthDataQueryOptions(connection, month));
    }
  }, [windowStart, availableMonths, connection, queryClient]);
}
