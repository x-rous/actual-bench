"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import type { AccountClassRecord } from "@/lib/app-db/types";
import type { AccountClassChange, AccountClassMaps } from "@/lib/account-class";

type AccountClassesResponse = { accountClasses: AccountClassRecord[] };

/**
 * Bench-owned account classs for the active budget, kept in the app database.
 * They are never written to Actual, so changes apply immediately and are not
 * part of the staged draft. Unavailable without a budget id (no budget open).
 */
export function useAccountClasses() {
  const connection = useConnectionStore(selectActiveInstance);
  const budgetSyncId = connection?.budgetSyncId ?? null;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["accountClasses", budgetSyncId], [budgetSyncId]);

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<AccountClassRecord[]> => {
      const response = await fetch(`/api/account-classes?budgetSyncId=${encodeURIComponent(budgetSyncId ?? "")}`);
      if (!response.ok) throw new Error("Could not load account classes");
      return ((await response.json()) as AccountClassesResponse).accountClasses;
    },
    enabled: Boolean(budgetSyncId),
  });

  const mutation = useMutation({
    // The budget travels with the save: the user may switch budgets before the response arrives,
    // and the result must land in the cache of the budget it was saved for.
    mutationFn: async ({ budget, changes }: { budget: string; changes: AccountClassChange[] }): Promise<AccountClassRecord[]> => {
      const response = await fetch("/api/account-classes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetSyncId: budget, changes }),
      });
      if (!response.ok) throw new Error("Could not save the account class");
      return ((await response.json()) as AccountClassesResponse).accountClasses;
    },
    onSuccess: (accountClasses, { budget }) => {
      queryClient.setQueryData<AccountClassRecord[]>(["accountClasses", budget], accountClasses);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const maps = useMemo<AccountClassMaps>(() => {
    const accounts = new Map<string, AccountClassRecord["accountClass"]>();
    const groups = new Map<string, AccountClassRecord["accountClass"]>();
    for (const record of query.data ?? []) {
      (record.scope === "group" ? groups : accounts).set(record.accountId, record.accountClass);
    }
    return { accounts, groups };
  }, [query.data]);

  // `mutate` is stable, so callers can depend on `apply` without re-rendering memoized rows.
  const { mutate } = mutation;
  const apply = useCallback(
    (changes: AccountClassChange[]) => {
      if (budgetSyncId) mutate({ budget: budgetSyncId, changes });
    },
    [mutate, budgetSyncId]
  );

  return {
    /** Whether a budget is open, so the Class column is worth showing. */
    enabled: Boolean(budgetSyncId),
    /** False while loading, on error, or with no budget open: class controls stay disabled. */
    available: Boolean(budgetSyncId) && query.isSuccess,
    maps,
    apply,
    isSaving: mutation.isPending,
  };
}
