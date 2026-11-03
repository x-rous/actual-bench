"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import type { AccountReportingRecord } from "@/lib/app-db/types";
import type { AccountReportingChange } from "@/lib/app-db/accountReportingRepository";
import type { ReportingTreatment } from "@/lib/account-class/reporting";
import { saveAccountReporting } from "../lib/accountReportingApi";

/**
 * Bench-owned Financial Reporting choices for the active budget, kept in the app
 * database. Like account classes they are never written to Actual, so a change
 * applies immediately and is not part of the staged draft.
 */
export function useAccountReporting() {
  const connection = useConnectionStore(selectActiveInstance);
  const budgetSyncId = connection?.budgetSyncId ?? null;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["accountReporting", budgetSyncId], [budgetSyncId]);

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<AccountReportingRecord[]> => {
      const response = await fetch(`/api/account-reporting?budgetSyncId=${encodeURIComponent(budgetSyncId ?? "")}`);
      if (!response.ok) throw new Error("Could not load Financial Reporting choices");
      return ((await response.json()) as { accountReporting: AccountReportingRecord[] }).accountReporting;
    },
    enabled: Boolean(budgetSyncId),
  });

  const mutation = useMutation({
    // The budget travels with the save so the result lands in the cache of the budget it was saved for.
    mutationFn: ({ budget, changes }: { budget: string; changes: AccountReportingChange[] }) => saveAccountReporting(budget, changes),
    // Each response is the whole list as of that save, and overlapping saves can answer out of order, so no response is written to
    // the cache: once a save settles the list is read again, and what that read returns is the truth.
    onSettled: (_records, _error, { budget }) => {
      void queryClient.invalidateQueries({ queryKey: ["accountReporting", budget] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const byAccount = useMemo(() => {
    const map = new Map<string, ReportingTreatment>();
    for (const record of query.data ?? []) map.set(record.accountId, record.treatment);
    return map;
  }, [query.data]);

  const { mutate } = mutation;
  const apply = useCallback(
    (changes: AccountReportingChange[]) => {
      if (budgetSyncId) mutate({ budget: budgetSyncId, changes });
    },
    [mutate, budgetSyncId]
  );

  return {
    /** False while loading, on error, or with no budget open: the choices stay disabled. */
    available: Boolean(budgetSyncId) && query.isSuccess,
    /** The saved values could not be loaded. */
    failed: query.isError,
    refetch: query.refetch,
    byAccount,
    apply,
  };
}
