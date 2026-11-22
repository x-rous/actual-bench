"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { resolveAccountClass } from "@/lib/account-class";
import { accessOf } from "@/lib/account-class/access";
import { accessOverrides, isExcluded } from "@/lib/account-class/flags";
import { useAccountClasses } from "@/features/accounts/hooks/useAccountClasses";
import { useAccountFlags } from "@/features/accounts/hooks/useAccountFlags";
import { useLocalToday } from "@/features/assets-debt/lib/useLocalToday";
import type { OptionalRead, SnapAccount, Snapshot } from "@/lib/cashflow-planning/actuals";
import { readBudget, readLedger, readLoanForecasts, readShifts } from "../lib/reads";

const EMPTY_COSTS: Snapshot["loanCosts"] = [];
const EMPTY_SHIFTS: Snapshot["shifts"] = [];

export type CashflowData =
  | { state: "idle" }
  | { state: "loading"; stage?: string }
  | { state: "error"; message: string; retry: () => void }
  | {
      state: "ready"; snapshot: Snapshot; readAt: string; refreshing: boolean; refresh: () => void;
      /** Accounts without a class: they are still planned (on budget counts as cash), but classes make the defaults right. */
      unclassified: number;
      /** The loans or the budget are still being read: rows that follow them fill in when they arrive. */
      pending: { loans: boolean; budget: boolean };
      /** Optional reads that failed; the plan still works, but what follows them is empty. */
      failedReads: OptionalRead[];
    };

/**
 * Everything a plan lays over its own figures, read from Actual through the active transport: one ledger read (accounts,
 * categories, monthly movements, schedules), then the loans' projections and, only when a row follows it, the budget.
 * Account classes and flags come from the app database, as on the Accounts page. Read-only.
 */
export function useCashflowData(options: { enabled: boolean; needBudget: boolean; /** Ids of the transactions the open plan counts in another month. */ movedIds?: readonly string[] }): CashflowData {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  const today = useLocalToday();
  const classes = useAccountClasses();
  const flags = useAccountFlags();
  const [stage, setStage] = useState<string | undefined>(undefined);
  const budgetSyncId = connection?.budgetSyncId ?? null;
  const enabled = options.enabled && !!connection && !!budgetSyncId;

  const ledger = useQuery({
    queryKey: ["cashflow-planning", "ledger", connection?.id, budgetSyncId, today],
    queryFn: () => readLedger(connection!, today, setStage),
    enabled,
    // The plan is laid over what Actual holds now: read again whenever the page opens.
    refetchOnMount: "always",
  });

  const metaReady = classes.available && flags.available;
  const accounts = useMemo((): SnapAccount[] | null => {
    if (!ledger.data || !metaReady) return null;
    const groupNames = new Map((ledger.data.accountGroups ?? []).map((g) => [g.id, g.name]));
    return ledger.data.accounts.map((a) => {
      const groupId = a.groupId && groupNames.has(a.groupId) ? a.groupId : null;
      const resolved = resolveAccountClass(a.id, groupId, classes.maps);
      return {
        id: a.id, name: a.name, offBudget: a.offBudget, closed: a.closed, accountClass: resolved.accountClass,
        access: accessOf(resolved.accountClass, a.offBudget, accessOverrides(a.id, resolved.accountClass, a.offBudget, flags.maps)),
        excluded: isExcluded(a.id, groupId, flags.maps, resolved.source === "group"),
        groupName: groupId ? groupNames.get(groupId) ?? null : null,
      };
    });
  }, [ledger.data, metaReady, classes.maps, flags.maps]);

  const loanIds = useMemo(() => (accounts ?? []).filter((a) => a.accountClass === "loan" && !a.closed).map((a) => a.id).sort(), [accounts]);
  const loans = useQuery({
    queryKey: ["cashflow-planning", "loans", connection?.id, budgetSyncId, today, loanIds.join(",")],
    queryFn: () => readLoanForecasts(connection!, { budgetSyncId: budgetSyncId!, today, loanAccountIds: new Set(loanIds) }),
    enabled: enabled && !!accounts && loanIds.length > 0,
    refetchOnMount: "always",
    retry: false,
  });

  const budget = useQuery({
    queryKey: ["cashflow-planning", "budget", connection?.id, budgetSyncId, today.slice(0, 7)],
    queryFn: () => readBudget(connection!, queryClient, today.slice(0, 7)),
    enabled: enabled && !!ledger.data && options.needBudget,
    // Rebuilt whenever the ledger is read, from Budget Cockpit's shared month cache (it drops the months it writes; Refresh picks up changes made elsewhere).
    refetchOnMount: "always",
    retry: false,
  });

  // Tagged and moved transactions: optional, so a failed read does not block the plan (it is reported instead).
  const movedKey = [...(options.movedIds ?? [])].sort().join(",");
  const shifts = useQuery({
    queryKey: ["cashflow-planning", "shifts", connection?.id, budgetSyncId, today, movedKey],
    queryFn: () => readShifts(connection!, today, movedKey ? movedKey.split(",") : []),
    enabled: enabled && !!ledger.data,
    // Read again with the ledger: the tags and moves belong to the same transactions.
    refetchOnMount: "always",
    retry: false,
    placeholderData: (previous) => previous,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["cashflow-planning", "shifts", connection?.id] });
    void queryClient.invalidateQueries({ queryKey: ["cashflow-planning", "ledger", connection?.id] });
    void queryClient.invalidateQueries({ queryKey: ["cashflow-planning", "loans", connection?.id] });
    void queryClient.invalidateQueries({ queryKey: ["cashflow-planning", "budget", connection?.id] });
    void queryClient.invalidateQueries({ queryKey: ["budget-month-data", connection?.id] });
    void classes.refetch();
    void flags.refetch();
  }, [queryClient, connection?.id, classes, flags]);

  const { isError: loansFailed } = loans, { isError: shiftsFailed } = shifts;
  const schedulesFailed = ledger.data?.schedulesFailed ?? false;
  const failedReads = useMemo((): OptionalRead[] => [...(schedulesFailed ? ["schedules" as const] : []), ...(loansFailed ? ["loans" as const] : []), ...(shiftsFailed ? ["shifts" as const] : [])], [schedulesFailed, loansFailed, shiftsFailed]);

  const snapshot = useMemo((): Snapshot | null => {
    if (!ledger.data || !accounts) return null;
    return {
      failedReads,
      today, accounts, categories: ledger.data.categories, movement: ledger.data.movement, startingBalances: ledger.data.startingBalances,
      uncategorizedIn: ledger.data.uncategorizedIn, transfersIn: ledger.data.transfersIn, schedules: ledger.data.schedules,
      loans: loans.data?.forecasts ?? {}, loanCosts: loans.data?.costs ?? EMPTY_COSTS, shifts: shifts.data ?? EMPTY_SHIFTS, budget: budget.data ?? null,
    };
  }, [ledger.data, accounts, today, loans.data, shifts.data, budget.data, failedReads]);

  const { isError: ledgerFailed, error: ledgerError, isFetching: ledgerFetching, data: ledgerData } = ledger;
  const metaFailed = classes.failed || flags.failed;
  const loansPending = loans.isFetching && !loans.data, budgetPending = budget.isFetching && !budget.data;

  return useMemo((): CashflowData => {
    if (!enabled) return { state: "idle" };
    if ((ledgerFailed && !ledgerData) || metaFailed) {
      return { state: "error", message: metaFailed ? "The account classes could not be loaded" : ledgerError instanceof Error ? ledgerError.message : "Actual could not be read", retry: refresh };
    }
    if (!snapshot || !ledgerData) return { state: "loading", stage };
    return {
      state: "ready", snapshot, readAt: ledgerData.readAt, refreshing: ledgerFetching, refresh,
      unclassified: snapshot.accounts.filter((a) => !a.accountClass && !a.excluded && !a.closed).length,
      pending: { loans: loansPending, budget: budgetPending }, failedReads,
    };
  }, [enabled, failedReads, ledgerFailed, ledgerData, metaFailed, ledgerError, refresh, snapshot, stage, ledgerFetching, loansPending, budgetPending]);
}
