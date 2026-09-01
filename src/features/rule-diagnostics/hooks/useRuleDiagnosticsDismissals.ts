"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import type { Rule } from "@/types/entities";
import type { RuleDiagnosticsDismissalRecord } from "@/lib/app-db/types";
import { findingRuleIds, findingSignatures } from "../lib/dismissals";
import type { Finding } from "../types";

/**
 * The user's "not a problem" decisions, persisted per budget.
 *
 * They live in the app database rather than browser storage for the same reason
 * Payee Cleanup's do: a judgement about a budget's rules should survive a
 * different browser, a different machine, and clearing site data.
 */
export function useRuleDiagnosticsDismissals(options: { enabled: boolean }) {
  const connection = useConnectionStore(selectActiveInstance);
  const budgetSyncId = connection?.budgetSyncId ?? null;
  const queryClient = useQueryClient();

  const queryKey = useMemo(
    () => ["ruleDiagnosticsDismissals", budgetSyncId],
    [budgetSyncId]
  );

  const { data } = useQuery({
    queryKey,
    queryFn: async (): Promise<RuleDiagnosticsDismissalRecord[]> => {
      const response = await fetch(
        `/api/rule-diagnostics-dismissals?budgetSyncId=${encodeURIComponent(budgetSyncId ?? "")}`
      );
      if (!response.ok) throw new Error("Could not load your diagnostics decisions");
      const body = (await response.json()) as {
        dismissals: RuleDiagnosticsDismissalRecord[];
      };
      return body.dismissals;
    },
    enabled: options.enabled && Boolean(budgetSyncId),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  const create = useMutation({
    mutationFn: async (payload: object) => {
      const response = await fetch("/api/rule-diagnostics-dismissals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Could not save that decision");
    },
    onSuccess: invalidate,
    // Reported rather than swallowed: the finding disappears from the list
    // either way, so a silent failure would look like a saved decision until
    // the next scan brought it back with no explanation.
    onError: (error: Error) =>
      toast.error(`${error.message} — it will reappear on the next scan.`),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(
        `/api/rule-diagnostics-dismissals/${id}?budgetSyncId=${encodeURIComponent(
          budgetSyncId ?? ""
        )}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("Could not restore that finding");
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  /**
   * Garbage collection, fired after a scan.
   *
   * Silent on failure by design: nothing the user asked for has gone wrong, the
   * stale rows are invisible either way, and the next scan tries again.
   */
  const collect = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      await fetch(
        `/api/rule-diagnostics-dismissals?budgetSyncId=${encodeURIComponent(budgetSyncId ?? "")}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        }
      );
    },
    onSuccess: invalidate,
    onError: () => {},
  });

  return {
    dismissals: data ?? [],
    /**
     * Records a decision about one finding: which rules, what they looked like
     * at the time, and the evidence the judgement was about.
     */
    dismiss: (finding: Finding, rulesById: Map<string, Rule>) => {
      if (!budgetSyncId) return;
      create.mutate({
        budgetSyncId,
        code: finding.code,
        ruleIds: findingRuleIds(finding),
        signatures: findingSignatures(finding, rulesById),
        ...(finding.discriminator ? { discriminator: finding.discriminator } : {}),
      });
    },
    restore: (id: string) => {
      if (!budgetSyncId) return;
      remove.mutate(id);
    },
    collectGarbage: (ids: string[]) => {
      if (!budgetSyncId || ids.length === 0) return;
      collect.mutate(ids);
    },
    isSaving: create.isPending || remove.isPending,
  };
}
