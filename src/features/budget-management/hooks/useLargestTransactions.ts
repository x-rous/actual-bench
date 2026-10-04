"use client";

import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import type { EvidenceQueryParams } from "../lib/varianceInvestigation/varianceEvidence";
import {
  fetchLargestTransactions,
  type LargestTransactions,
} from "../lib/varianceInvestigation/varianceEvidenceFetch";

/**
 * The largest transactions for the Variance Drivers evidence panel.
 *
 * Loaded on demand and only while `enabled`, one small page at a time. The
 * previous page stays on screen while the next one loads, so changing the
 * driver or month does not flash an empty table.
 */
export function useLargestTransactions(
  params: EvidenceQueryParams,
  enabled: boolean
): {
  data: LargestTransactions | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
} {
  const connection = useConnectionStore(selectActiveInstance);
  const ids = useMemo(() => [...params.categoryIds].sort(), [params.categoryIds]);

  const query = useQuery({
    queryKey: [
      "variance-largest-transactions",
      connection?.id,
      params.side,
      params.monthStart,
      params.monthEnd,
      ids.join(","),
      params.limit,
    ],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return fetchLargestTransactions(connection, { ...params, categoryIds: ids });
    },
    enabled: enabled && !!connection && ids.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}
