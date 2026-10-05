"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getTransport } from "@/lib/actual";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import { datedBalanceFromTransactions, readAccountLedger, readMatchingHistory, toDebtMagnitude, type AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import type { OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";
import type { UnscheduledPayment } from "@/lib/assets-debt/services/extraPaymentService";
import type { PlanningNotice } from "@/lib/assets-debt/services/planner/common";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { getDebtReconciliation, type DebtReconciliationView } from "../../lib/debtsApi";
import { startTiming } from "../../lib/debugTiming";
import { previewPostings } from "../../lib/postingsApi";

/**
 * Background refresh of a loan's Activity (RD-084 P1.6b T289; FR-206b,
 * `ux-loan-workspace.md` §3.3).
 *
 * On open the page shows what it already has: stored proposals and postings
 * from the app DB, and the last-known status from this browser's cache. The
 * same read-only Actual read the preview always did then runs in the
 * background; proposals are re-planned on the server and the status strip's
 * figures come from the existing reconciliation route.
 *
 * The browser cache is display only (owner refinement 4): scoped by server,
 * budget, loan and configuration revision, shown with its age, invalidated on
 * apply, undo or a new revision, and never used for any apply or preflight
 * decision; those always re-read Actual.
 */

export type LoanStatus = {
  /** When Actual was last read for these figures (ISO). */
  at: string;
  comparisonDate: string;
  actualMinor: number | null;
  modelMinor: number | null;
  lenderMinor: number | null;
  lenderDate: string | null;
  modelVsActualMinor: number | null;
  actualVsLenderMinor: number | null;
  drift: string;
  reconciliationOverdue: boolean;
  /** The calculation on schedule, when "Calculated" follows the repayments as paid (T309). */
  scheduledMinor?: number | null;
  asPaidFrom?: string | null;
};

export type RefreshState = {
  phase: "idle" | "refreshing" | "done" | "failed";
  error: string | null;
  status: LoanStatus | null;
  /** True when `status` came from the cache and the refresh has not replaced it yet. */
  statusFromCache: boolean;
  notices: PlanningNotice[];
  driftMaterial: boolean;
  /** The pending changes close the gap with Actual (FR-170c). */
  driftExplained: boolean;
  /** Payments into the loan account no repayment accounts for (extra payments). */
  unscheduled: UnscheduledPayment[];
};

const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const PAD_DAYS = 31;

export function loanStatusKey(input: { baseUrl: string; budgetSyncId: string; debtId: string; revision: number }): string {
  return `ab:loan-status:v2:${input.baseUrl}:${input.budgetSyncId}:${input.debtId}:r${input.revision}`;
}

export function readCachedStatus(key: string | null): LoanStatus | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as LoanStatus) : null;
  } catch {
    return null;
  }
}

function writeCachedStatus(key: string | null, status: LoanStatus): void {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(status));
  } catch {
    // storage unavailable: the strip simply waits for the next refresh
  }
}

/** After an apply or undo the cached figures are no longer true: drop every revision's entry for the loan. */
export function invalidateCachedStatus(input: { baseUrl: string; budgetSyncId: string; debtId: string }): void {
  try {
    const prefix = `ab:loan-status:v2:${input.baseUrl}:${input.budgetSyncId}:${input.debtId}:`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch {
    // storage unavailable
  }
}

async function transferPayees(transport: ActualBenchTransport): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const payee of await transport.getPayees()) if (payee.transferAccountId) out[payee.transferAccountId] = payee.id;
  return out;
}

export function useBackgroundRefresh(input: { debt: DebtDetail; directory: AccountDirectory | undefined; offsetHistories?: OffsetHistorySnapshot[]; from: string; to: string }) {
  const { debt, directory, offsetHistories, from, to } = input;
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  const debtId = debt.debt.id;
  const cacheKey = connection && connection.budgetSyncId ? loanStatusKey({ baseUrl: connection.baseUrl, budgetSyncId: connection.budgetSyncId, debtId, revision: debt.debt.currentRevision }) : null;
  const [state, setState] = useState<RefreshState>(() => {
    const cached = readCachedStatus(cacheKey);
    return { phase: "idle", error: null, status: cached, statusFromCache: cached !== null, notices: [], driftMaterial: false, driftExplained: false, unscheduled: [] };
  });
  const [payees, setPayees] = useState<Record<string, string>>({});
  const running = useRef(false);

  const refresh = useCallback(async () => {
    const liabilityId = debt.debt.liabilityAccountId;
    if (!connection || !directory || !liabilityId || running.current) return;
    running.current = true;
    setState((s) => ({ ...s, phase: "refreshing", error: null }));
    const timing = startTiming("loan refresh");
    try {
      const transport = getTransport(connection);
      // Pull changes made elsewhere (a transfer added in Actual) before reading: in Direct mode the
      // browser reads its own copy of the budget, which otherwise only syncs when it first opens.
      let syncProblem: string | null = null;
      try {
        await transport.sync();
      } catch (error) {
        syncProblem = error instanceof Error ? error.message : String(error);
      }
      timing.step("sync");
      const payeeMap = await transferPayees(transport);
      setPayees(payeeMap);
      timing.step("payees");
      // The loan account is read once, in full: dated balances and its matching history.
      const readFrom = shift(from, -PAD_DAYS);
      const readTo = shift(to, PAD_DAYS);
      const ledger = await readAccountLedger(transport, { accountId: liabilityId });
      if (!ledger.ok) throw new Error(ledger.message);
      timing.step("loan account");
      const paymentAccountId = debt.debt.paymentAccountId && debt.debt.paymentAccountId !== liabilityId ? debt.debt.paymentAccountId : null;
      const snapshots = [
        { accountId: liabilityId, transactions: ledger.transactions.filter((t) => t.date >= readFrom && t.date <= readTo) },
        ...(paymentAccountId ? await readMatchingHistory(transport, { accountIds: [paymentAccountId], from: readFrom, to: readTo }) : []),
      ];
      timing.step("repayment account");
      const sign = typeof debt.debt.signConvention === "string" ? debt.debt.signConvention : "negative-is-debt";
      const comparisonDate = to;
      const actualMagnitude = toDebtMagnitude(datedBalanceFromTransactions(liabilityId, ledger.transactions, comparisonDate).balanceMinor, sign);
      const onboarding = debt.debt.onboardingDate ? toDebtMagnitude(datedBalanceFromTransactions(liabilityId, ledger.transactions, debt.debt.onboardingDate).balanceMinor, sign) : null;
      const canVerifyTransferLinks = transport.canVerifyTransferLinks ? await transport.canVerifyTransferLinks({ accountId: liabilityId, sinceDate: readFrom }) : false;
      const result = await previewPostings(debtId, {
        from, to, snapshots, accountDirectory: directory, transferPayees: payeeMap,
        capabilities: { canRestructure: typeof transport.restructureTransactionAsSplit === "function" && typeof transport.linkTransferCounterpart === "function", canVerifyTransferLinks },
        offsetHistories,
        loanAccountRows: ledger.transactions.filter((t) => (t as { isChild?: boolean }).isChild !== true).map((t) => ({ id: t.id, date: t.date, amountMinor: t.amount })),
        comparison: actualMagnitude >= 0 ? { comparisonDate, actualBalanceMinor: actualMagnitude } : null,
        parameters: { openingAdjustmentCategoryId: null, adjustmentCategoryId: null, actualBalanceAtOnboardingMinor: onboarding },
      });
      timing.step("plan changes (server)");
      const followed = result.followedExtraPayments ?? [];
      if (followed.length) {
        // Terms & Schedule was saved as a new revision on the server: show it everywhere.
        void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debt", debtId] });
        void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debts"] });
        toast.success(followed.length === 1 ? (followed[0].change === "removed" ? "An extra payment was deleted in Actual; it was removed from Terms & Schedule" : "An extra payment changed in Actual; Terms & Schedule was updated to match") : `${followed.length} extra payments changed in Actual; Terms & Schedule was updated to match`);
      }
      let status: LoanStatus | null = null;
      if (actualMagnitude >= 0) {
        const view: DebtReconciliationView = await getDebtReconciliation(debtId, { comparisonDate, actualBalanceMinor: actualMagnitude, offsetHistories });
        status = {
          at: new Date().toISOString(),
          comparisonDate,
          actualMinor: view.comparison.actualMinor,
          modelMinor: view.comparison.modelMinor,
          lenderMinor: view.comparison.lenderMinor,
          lenderDate: view.lenderObservation?.observedOn ?? null,
          modelVsActualMinor: view.comparison.modelVsActualMinor,
          actualVsLenderMinor: view.comparison.actualVsLenderMinor,
          drift: String(view.drift),
          reconciliationOverdue: view.health.overdue,
          scheduledMinor: view.scheduledMinor ?? null,
          asPaidFrom: view.asPaidFrom ?? null,
        };
        writeCachedStatus(cacheKey, status);
        timing.step("reconciliation (server)");
      }
      timing.end();
      setState((s) => ({ phase: syncProblem ? "failed" : "done", error: syncProblem ? `could not get the latest changes from Actual (${syncProblem}); showing what this browser last downloaded` : null, status: status ?? s.status, statusFromCache: status === null && s.statusFromCache, notices: result.notices, driftMaterial: result.driftMaterial, driftExplained: result.driftExplained === true, unscheduled: result.unscheduled ?? [] }));
      void queryClient.invalidateQueries({ queryKey: ["assets-debt", "postings", debtId] });
    } catch (error) {
      // Keep everything already shown; say it may be out of date.
      setState((s) => ({ ...s, phase: "failed", error: error instanceof Error ? error.message : String(error) }));
    } finally {
      running.current = false;
    }
  }, [connection, directory, debt, debtId, from, to, offsetHistories, cacheKey, queryClient]);

  // Refresh once when the page opens (and when the period or revision changes).
  const started = useRef<string | null>(null);
  useEffect(() => {
    const signature = `${cacheKey}:${from}:${to}:${directory ? "dir" : "nodir"}`;
    if (!connection || !directory || started.current === signature) return;
    started.current = signature;
    void refresh();
  }, [connection, directory, cacheKey, from, to, refresh]);

  const invalidate = useCallback(() => {
    if (connection && connection.budgetSyncId) invalidateCachedStatus({ baseUrl: connection.baseUrl, budgetSyncId: connection.budgetSyncId, debtId });
  }, [connection, debtId]);

  return { ...state, refresh, invalidate, transferPayees: payees };
}
