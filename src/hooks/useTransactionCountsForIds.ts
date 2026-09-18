"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import {
  getAllTransactionCounts,
  getTransactionCountsForIds,
} from "@/lib/api/query";
import type { TransactionCountGroupField } from "@/lib/api/query";

/**
 * Fetches transaction counts for a specific set of entity IDs via a single
 * $oneof-filtered ActualQL query.
 *
 * Lazy by design — fires only when `options.enabled` is true.
 * Use this exclusively for delete/close impact warnings and the inspector drawer.
 * Never call on page mount. Never set a refetchInterval.
 *
 * Query key includes sorted IDs so different click-orders for the same selection
 * hit the same cache entry.
 *
 * Cache is invalidated by each entity's save hook after successful mutations.
 * staleTime: 30s — handles rapid re-opens of the same dialog without re-fetching.
 * gcTime: 60s — no long-term retention.
 */
export function useTransactionCountsForIds(
  groupField: TransactionCountGroupField,
  ids: string[],
  options: { enabled: boolean }
): {
  data: Map<string, number> | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const connection = useConnectionStore(selectActiveInstance);

  const sortedIds = [...ids].sort();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["transactionCounts", groupField, connection?.id, sortedIds],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getTransactionCountsForIds(connection, groupField, sortedIds);
    },
    enabled: options.enabled && ids.length > 0 && !!connection,
    staleTime: 30_000,
    gcTime: 60_000,
  });
  const refresh = useCallback(() => void refetch(), [refetch]);

  return {
    data,
    isLoading,
    isFetching,
    error,
    refetch: refresh,
  };
}

/**
 * Loads one complete grouped count map without placing every entity id in the
 * query. Use this only for a whole-budget workflow that genuinely needs to
 * identify zero-use entities; ordinary impact dialogs should keep using the
 * targeted hook above.
 */
export function useAllTransactionCounts(
  groupField: TransactionCountGroupField,
  options: { enabled: boolean }
): {
  data: Map<string, number> | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const connection = useConnectionStore(selectActiveInstance);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["transactionCounts", groupField, connection?.id, "all"],
    queryFn: () => {
      if (!connection) throw new Error("No active connection");
      return getAllTransactionCounts(connection, groupField);
    },
    enabled: options.enabled && !!connection,
    staleTime: 30_000,
    gcTime: 60_000,
  });
  const refresh = useCallback(() => void refetch(), [refetch]);

  return {
    data,
    isLoading,
    isFetching,
    error,
    refetch: refresh,
  };
}
