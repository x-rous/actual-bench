"use client";
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { fetchPickerPage, PICKER_PAGE_SIZE, type PickedTransaction, type PickerConstraints, type PickerFilterState } from "./transactionPickerQuery";

const SETTLE_MS = 250;
/**
 * The matches for a filter state, one page of Actual rows at a time (newest first). `rows` are the loaded matches that also
 * pass the exact client-side tests; `hasMore` says Actual has further pages, which `loadMore` fetches. Read-only.
 */
export function useTransactionSearch(wanted: PickerFilterState, constraints: PickerConstraints | undefined, today: string) {
  // Typing in the Amount chip or an Advanced condition changes the filter on every keystroke; ask Actual once it settles.
  const [state, setState] = useState(wanted);
  useEffect(() => { const timer = setTimeout(() => setState(wanted), SETTLE_MS); return () => clearTimeout(timer); }, [wanted]);
  const connection = useConnectionStore(selectActiveInstance);
  const key = useMemo(() => JSON.stringify([connection?.id, state, constraints, today]), [connection?.id, state, constraints, today]);
  const query = useInfiniteQuery({
    queryKey: ["transactionPicker", key], enabled: !!connection, initialPageParam: 0,
    // Each filter state is a fresh read of up to many pages: do not keep the old ones for the whole session.
    gcTime: 60_000,
    queryFn: ({ pageParam }) => fetchPickerPage(connection!, state, constraints ?? {}, today, pageParam),
    getNextPageParam: (last, pages) => last.fetched < PICKER_PAGE_SIZE ? undefined : pages.length * PICKER_PAGE_SIZE,
  });
  const rows = useMemo<PickedTransaction[]>(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const loadMore = useMemo(() => () => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage(); }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  return { rows, pageCount: query.data?.pages.length ?? 0, hasMore: !!hasNextPage, loadMore, isPending: query.isPending, isFetching: query.isFetching, isError: query.isError, error: query.error };
}
