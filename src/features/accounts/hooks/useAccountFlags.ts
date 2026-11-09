"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import type { AccountFlagRecord } from "@/lib/app-db/types";
import type { AccountFlag, AccountFlagChange, AccountFlagMaps } from "@/lib/account-class/flags";
import { saveAccountFlags } from "../lib/accountFlagApi";

/**
 * Bench-owned account flags for the active budget, kept in the app database. Like account classes they are never written to
 * Actual, so a change applies immediately and is not part of the staged draft.
 */
export function useAccountFlags() {
  const connection = useConnectionStore(selectActiveInstance);
  const budgetSyncId = connection?.budgetSyncId ?? null;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["accountFlags", budgetSyncId], [budgetSyncId]);

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<AccountFlagRecord[]> => {
      const response = await fetch(`/api/account-flags?budgetSyncId=${encodeURIComponent(budgetSyncId ?? "")}`);
      if (!response.ok) throw new Error("Could not load account settings");
      return ((await response.json()) as { accountFlags: AccountFlagRecord[] }).accountFlags;
    },
    enabled: Boolean(budgetSyncId),
  });

  const mutation = useMutation({
    // The budget travels with the save so the result lands in the cache of the budget it was saved for.
    mutationFn: ({ budget, changes }: { budget: string; changes: AccountFlagChange[] }) => saveAccountFlags(budget, changes),
    // Each response is the whole list as of that save, and overlapping saves can answer out of order, so no response is written to
    // the cache: once a save settles the list is read again, and what that read returns is the truth.
    onSettled: (_records, _error, { budget }) => {
      void queryClient.invalidateQueries({ queryKey: ["accountFlags", budget] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const maps = useMemo((): AccountFlagMaps => {
    const accounts = new Map<AccountFlag, Set<string>>();
    const groups = new Set<string>();
    for (const record of query.data ?? []) {
      if (record.scope === "group") { if (record.flag === "excluded") groups.add(record.targetId); continue; }
      const set = accounts.get(record.flag) ?? new Set<string>();
      set.add(record.targetId);
      accounts.set(record.flag, set);
    }
    return { accounts, groups };
  }, [query.data]);

  const { mutate } = mutation;
  const apply = useCallback(
    (changes: AccountFlagChange[]) => {
      if (budgetSyncId) mutate({ budget: budgetSyncId, changes });
    },
    [mutate, budgetSyncId]
  );

  return {
    /** False while loading, on error, or with no budget open: the settings stay disabled. */
    available: Boolean(budgetSyncId) && query.isSuccess,
    /** The saved values could not be loaded. */
    failed: query.isError,
    refetch: query.refetch,
    maps,
    apply,
  };
}
