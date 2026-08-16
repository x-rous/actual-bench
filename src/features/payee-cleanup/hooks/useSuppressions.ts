"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import type { PayeeCleanupSuppressionRecord } from "@/lib/app-db/types";
import type { PayeeCluster } from "../lib/clusterResolver";
import type { CorpusAffix } from "../lib/corpusAffixes";
import { buildAffixSuppression, buildClusterSuppression } from "../lib/suppressions";

/**
 * The user's "not duplicates" decisions, persisted per budget.
 *
 * Suppressions live in the app database rather than browser storage because a
 * decision about a budget's payees should survive a different browser, a
 * different machine, and clearing site data — the same reasoning that moved
 * saved queries out of `localStorage` in RD-064.
 */
export function useSuppressions(options: { enabled: boolean }) {
  const connection = useConnectionStore(selectActiveInstance);
  const budgetSyncId = connection?.budgetSyncId ?? null;
  const queryClient = useQueryClient();

  const queryKey = useMemo(
    () => ["payeeCleanupSuppressions", budgetSyncId],
    [budgetSyncId]
  );

  const { data } = useQuery({
    queryKey,
    queryFn: async (): Promise<PayeeCleanupSuppressionRecord[]> => {
      const response = await fetch(
        `/api/payee-cleanup-suppressions?budgetSyncId=${encodeURIComponent(budgetSyncId ?? "")}`
      );
      if (!response.ok) throw new Error("Could not load cleanup decisions");
      const body = (await response.json()) as {
        suppressions: PayeeCleanupSuppressionRecord[];
      };
      return body.suppressions;
    },
    enabled: options.enabled && Boolean(budgetSyncId),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey });
    // The scan reads suppressions, so it has to re-run for the change to show.
  }, [queryClient, queryKey]);

  const create = useMutation({
    mutationFn: async (payload: object) => {
      const response = await fetch("/api/payee-cleanup-suppressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Could not save that decision");
    },
    onSuccess: invalidate,
    // Reported rather than swallowed: the card disappears locally either way,
    // so a silent failure would look like a saved decision until the next scan
    // brought the group back with no explanation.
    onError: (error: Error) =>
      toast.error(`${error.message} — it will reappear on the next scan.`),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/payee-cleanup-suppressions/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Could not undo that decision");
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/payee-cleanup-suppressions?budgetSyncId=${encodeURIComponent(budgetSyncId ?? "")}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("Could not clear your decisions");
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  return {
    suppressions: data ?? [],
    /** Records the whole grouping, not the individual payees (see lib/suppressions). */
    rejectCluster: (cluster: PayeeCluster) => {
      if (!budgetSyncId) return;
      create.mutate(buildClusterSuppression(budgetSyncId, cluster));
    },
    /** Stops a learned fragment being treated as boilerplate anywhere. */
    rejectAffix: (affix: CorpusAffix) => {
      if (!budgetSyncId) return;
      create.mutate(buildAffixSuppression(budgetSyncId, affix));
    },
    undo: (id: string) => remove.mutate(id),
    // Guarded like the others. Without a budget id this sent an unscoped DELETE
    // — a destructive request with nothing to scope it to.
    clearAll: () => {
      if (!budgetSyncId) return;
      clearAll.mutate();
    },
    isSaving: create.isPending || remove.isPending || clearAll.isPending,
  };
}
