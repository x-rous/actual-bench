"use client";

import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SavedQueryRecord } from "@/lib/app-db/types";
import * as api from "../lib/savedQueriesApi";
import { migrateLegacySavedQueriesOnce } from "../lib/savedQueriesMigration";

const SAVED_QUERIES_KEY = ["saved-queries"] as const;

/**
 * Persistent, cross-budget saved ActualQL queries (RD-064 / PR-029).
 *
 * Backed by the server-side app DB rather than per-budget localStorage, so the
 * same list is available from every budget and survives across devices. Exposes
 * the granular operations the query workspace needs; all writes invalidate the
 * single global list.
 */
export function useSavedQueries() {
  const queryClient = useQueryClient();
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: SAVED_QUERIES_KEY }),
    [queryClient]
  );

  const query = useQuery({
    queryKey: SAVED_QUERIES_KEY,
    queryFn: async () => (await api.listSavedQueries()).savedQueries,
  });

  const savedQueries: SavedQueryRecord[] = query.data ?? [];

  // One-time import of pre-RD-064 per-budget localStorage saved queries into the
  // global DB. Runs at most once per browser; refetch afterwards so any imported
  // rows appear. The migration itself is idempotent (dedupes server-side).
  const migrationRan = useRef(false);
  useEffect(() => {
    if (migrationRan.current) return;
    migrationRan.current = true;
    void migrateLegacySavedQueriesOnce(api.importSavedQueries).then((imported) => {
      if (imported > 0) void invalidate();
    });
  }, [invalidate]);

  const create = useMutation({
    mutationFn: (input: api.SavedQueryCreateInput) => api.createSavedQuery(input),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: api.SavedQueryPatch }) =>
      api.updateSavedQuery(id, patch),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSavedQuery(id),
    onSuccess: invalidate,
  });

  const saveQuery = useCallback(
    (name: string, queryText: string) => create.mutateAsync({ name, query: queryText }),
    [create]
  );

  const renameQuery = useCallback(
    (id: string, name: string) => update.mutateAsync({ id, patch: { name } }),
    [update]
  );

  const toggleFavorite = useCallback(
    (id: string, isFavorite: boolean) => update.mutateAsync({ id, patch: { isFavorite } }),
    [update]
  );

  const deleteQuery = useCallback((id: string) => remove.mutateAsync(id), [remove]);

  const duplicateQuery = useCallback(
    (source: SavedQueryRecord) =>
      create.mutateAsync({ name: `${source.name} (copy)`, query: source.query }),
    [create]
  );

  return {
    savedQueries,
    isLoading: query.isLoading,
    saveQuery,
    renameQuery,
    toggleFavorite,
    deleteQuery,
    duplicateQuery,
  };
}
