"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { fetchScheduleTransactions } from "../lib/scheduleTransactionsQuery";
import type { ScheduleTxRow } from "../lib/scheduleTransactionsQuery";

/**
 * Fetches all transactions linked to any schedule in the past 2 years via a
 * single ActualQL query. Returns Map<scheduleId, ScheduleTxRow[]>.
 *
 * Fires on page mount so status badges (Paid / Missed / Due / Upcoming) are
 * available immediately when the Schedules page loads.
 *
 * staleTime: 60s — avoids redundant refetches on quick navigation away/back.
 * gcTime: 120s — keeps data briefly after unmount.
 */
export function useScheduleTransactions(): {
  data: Map<string, ScheduleTxRow[]> | undefined;
  isLoading: boolean;
} {
  const connection = useConnectionStore(selectActiveInstance);

  const { data, isLoading } = useQuery({
    queryKey: ["scheduleTransactions", connection?.id],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return fetchScheduleTransactions(connection);
    },
    enabled: !!connection,
    staleTime: 60_000,
    gcTime: 120_000,
  });

  return { data, isLoading };
}
