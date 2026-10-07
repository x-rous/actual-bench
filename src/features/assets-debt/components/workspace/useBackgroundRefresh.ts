"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getTransport } from "@/lib/actual";
import type { ActualBenchTransport, TransactionReadSession } from "@/lib/actual/transport";
import { datedBalanceFromTransactions, readAccountLedger, toDebtMagnitude, type AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import type { OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";
import type { UnscheduledPayment } from "@/lib/assets-debt/services/extraPaymentService";
import type { PaymentOption } from "@/lib/assets-debt/services/proposalService";
import type { PlanningNotice } from "@/lib/assets-debt/services/planner/common";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { getDebtReconciliation, listMatchRules, type DebtReconciliationView } from "../../lib/debtsApi";
import { startTiming } from "../../lib/debugTiming";
import { listPostings, previewPostings } from "../../lib/postingsApi";
import { checkInterruptedPosting } from "../../lib/postingActions";
import { planBankReads, readRanges } from "../../lib/scopedReads";
import { noteSynced } from "../../lib/syncFreshness";
import { identifies, settledPaymentOf } from "@/lib/assets-debt/services/repaymentAlignment";
import type { MatchConditionsV1 } from "@/lib/financial-models/matching";

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
  /** The loan's payments a due date can be given ("this is the payment"), and the choices made. */
  paymentOptions: PaymentOption[];
  repaymentChoices: Array<{ key: string; paymentId: string }>;
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

/**
 * One read of Actual for a loan and the server's re-plan (the refresh behind Sync Repayments, also
 * run quietly for each active loan from the loans list): sync, read the loan account in full and the
 * repayment account over the period, re-plan the changes, and work out the status figures.
 */
export async function runLoanRefresh(input: {
  connection: Parameters<typeof getTransport>[0];
  directory: AccountDirectory;
  debt: DebtDetail;
  from: string;
  to: string;
  offsetHistories?: OffsetHistorySnapshot[];
  cacheKey?: string | null;
  /** Terms & Schedule has unsaved edits: do not move linked extra payments meanwhile. */
  scheduleDirty?: boolean;
}): Promise<{ payeeMap: Record<string, string>; result: Awaited<ReturnType<typeof previewPostings>>; status: LoanStatus | null; syncProblem: string | null }> {
  const { connection, debt } = input;
  const liabilityId = debt.debt.liabilityAccountId;
  if (!liabilityId) throw new Error("The loan has no loan account in Actual yet.");
  const timing = startTiming("loan refresh");
  const baseTransport = getTransport(connection);
  // Pull changes made elsewhere (a transfer added in Actual) before reading: in Direct mode the
  // browser reads its own copy of the budget, which otherwise only syncs when it first opens.
  let syncProblem: string | null = null;
  try {
    await baseTransport.sync();
    noteSynced(connection.id);
  } catch (error) {
    syncProblem = error instanceof Error ? error.message : String(error);
  }
  timing.step("sync");
  const read = (reader: TransactionReadSession) => readLoanRefresh(input, { ...baseTransport, ...reader }, syncProblem, timing);
  return baseTransport.withTransactionReadSession
    ? baseTransport.withTransactionReadSession(read)
    : read(baseTransport);
}

async function readLoanRefresh(
  input: Parameters<typeof runLoanRefresh>[0],
  transport: ActualBenchTransport,
  syncProblem: string | null,
  timing: ReturnType<typeof startTiming>
) {
  const { directory, debt, from, to, offsetHistories } = input;
  const debtId = debt.debt.id;
  const liabilityId = debt.debt.liabilityAccountId!;
  const payeeMap = await transferPayees(transport);
  timing.step("payees");
  // The loan account is read once, in full: dated balances and its matching history.
  const readFrom = shift(from, -PAD_DAYS);
  const readTo = shift(to, PAD_DAYS);
  const ledger = await readAccountLedger(transport, { accountId: liabilityId });
  if (!ledger.ok) throw new Error(ledger.message);
  timing.step("loan account");
  const paymentAccountId = debt.debt.paymentAccountId && debt.debt.paymentAccountId !== liabilityId ? debt.debt.paymentAccountId : null;
  // The other side only where it matters (owner decision 2026-10-07): the days of the loan's
  // transfers and of the payments Bench applied, and for repayments that are not transfers the
  // repayment account from a little before the last split.
  const [initialPostings, rules] = await Promise.all([listPostings(debtId), listMatchRules(debtId)]);
  let postings = initialPostings;
  // An interrupted change is checked against Actual on its own (read only) and its outcome recorded,
  // so its due date is never left counted as done when nothing landed. A link left halfway still
  // asks the user, since finishing it writes to Actual.
  const interrupted = postings.filter((p) => String(p.status) === "indeterminate");
  if (interrupted.length) {
    const ctx = { transport, liabilityAccountId: liabilityId, transferPayeeByAccount: payeeMap, offBudgetAccountIds: new Set(directory.accounts.filter((a) => a.offBudget).map((a) => a.id)) };
    for (const posting of interrupted) {
      try {
        await checkInterruptedPosting(posting, ctx);
      } catch {
        // Left for the row's own Check button.
      }
    }
    postings = await listPostings(debtId);
  }
  const applied = postings.flatMap((p) => (String(p.status) === "applied" && ["repayment-split", "repayment-link"].includes(String(p.postingKind)) ? [settledPaymentOf(p.output)].filter((x): x is NonNullable<typeof x> => !!x) : []));
  const splits = postings.filter((p) => String(p.status) === "applied" && p.postingKind === "repayment-split").flatMap((p) => [settledPaymentOf(p.output)?.date].filter((d): d is string => !!d));
  const rule = rules.find((r) => r.record.purpose === "repayment" && r.record.enabled && r.conditions)?.conditions ?? null;
  const plan = planBankReads({
    loanRows: ledger.transactions, liabilityAccountId: liabilityId,
    accountByTransferPayee: Object.fromEntries(Object.entries(payeeMap).map(([accountId, payeeId]) => [payeeId, accountId])),
    applied, paymentAccountId, ruleIdentifies: !!rule && identifies(rule as MatchConditionsV1),
    lastSplitDate: splits.length ? splits.reduce((a, b) => (b > a ? b : a)) : null,
    window: { from, to },
  });
  const snapshots = [
    { accountId: liabilityId, transactions: ledger.transactions.filter((t) => t.date >= readFrom && t.date <= readTo) },
    ...(await readRanges(transport, plan)),
  ];
  timing.step(`other side (${plan.length} reads)`);
  const sign = typeof debt.debt.signConvention === "string" ? debt.debt.signConvention : "negative-is-debt";
  const comparisonDate = to;
  const actualMagnitude = toDebtMagnitude(datedBalanceFromTransactions(liabilityId, ledger.transactions, comparisonDate).balanceMinor, sign);
  const onboarding = debt.debt.onboardingDate ? toDebtMagnitude(datedBalanceFromTransactions(liabilityId, ledger.transactions, debt.debt.onboardingDate).balanceMinor, sign) : null;
  const canVerifyTransferLinks = transport.canVerifyTransferLinks ? await transport.canVerifyTransferLinks({ accountId: liabilityId, sinceDate: readFrom }) : false;
  const result = await previewPostings(debtId, {
    from, to, snapshots, accountDirectory: directory, transferPayees: payeeMap,
    capabilities: { canRestructure: typeof transport.restructureTransactionAsSplit === "function" && typeof transport.linkTransferCounterpart === "function", canVerifyTransferLinks },
    offsetHistories,
    followExtraPayments: !input.scheduleDirty,
    readRanges: [{ accountId: liabilityId, from: readFrom, to: readTo }, ...plan],
    loanAccountRows: ledger.transactions.filter((t) => (t as { isChild?: boolean }).isChild !== true).map((t) => ({ id: t.id, date: t.date, amountMinor: t.amount })),
    comparison: actualMagnitude >= 0 ? { comparisonDate, actualBalanceMinor: actualMagnitude } : null,
    parameters: { openingAdjustmentCategoryId: null, adjustmentCategoryId: null, actualBalanceAtOnboardingMinor: onboarding },
  });
  timing.step("plan changes (server)");
  let status: LoanStatus | null = null;
  if (actualMagnitude >= 0) {
    // The re-plan returns the status figures too; ask separately only from an older server.
    const view: DebtReconciliationView = (result.reconciliation as DebtReconciliationView | null | undefined) ?? await getDebtReconciliation(debtId, { comparisonDate, actualBalanceMinor: actualMagnitude, offsetHistories });
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
    writeCachedStatus(input.cacheKey ?? null, status);
    timing.step("reconciliation (server)");
  }
  timing.end();
  return { payeeMap, result, status, syncProblem };
}

export function useBackgroundRefresh(input: { debt: DebtDetail; directory: AccountDirectory | undefined; offsetHistories?: OffsetHistorySnapshot[]; from: string; to: string; scheduleDirty?: boolean }) {
  const { debt, directory, offsetHistories, from, to } = input;
  const scheduleDirty = input.scheduleDirty === true;
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  const debtId = debt.debt.id;
  const cacheKey = connection && connection.budgetSyncId ? loanStatusKey({ baseUrl: connection.baseUrl, budgetSyncId: connection.budgetSyncId, debtId, revision: debt.debt.currentRevision }) : null;
  const [state, setState] = useState<RefreshState>(() => {
    const cached = readCachedStatus(cacheKey);
    return { phase: "idle", error: null, status: cached, statusFromCache: cached !== null, notices: [], driftMaterial: false, driftExplained: false, unscheduled: [], paymentOptions: [], repaymentChoices: [] };
  });
  const [payees, setPayees] = useState<Record<string, string>>({});
  const running = useRef(false);
  const pending = useRef(false);
  const rerun = useRef<(() => Promise<void>) | null>(null);

  const refresh = useCallback(async () => {
    const liabilityId = debt.debt.liabilityAccountId;
    if (!connection || !directory || !liabilityId) return;
    // One at a time; a request while one runs is kept and runs right after, never dropped.
    if (running.current) {
      pending.current = true;
      return;
    }
    running.current = true;
    setState((s) => ({ ...s, phase: "refreshing", error: null }));
    try {
      const { payeeMap, result, status, syncProblem } = await runLoanRefresh({ connection, directory, debt, from, to, offsetHistories, cacheKey, scheduleDirty });
      setPayees(payeeMap);
      const released = result.changedInActual ?? [];
      if (released.length) toast.info(released.length === 1 ? `A change you applied was changed in Actual (${released[0].detail}); Bench planned that due date again.` : `${released.length} changes you applied were changed in Actual; Bench planned those due dates again.`);
      const followed = result.followedExtraPayments ?? [];
      if (followed.length) {
        // Terms & Schedule was saved as a new revision on the server: show it everywhere.
        void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debt", debtId] });
        void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debts"] });
        toast.success(followed.length === 1 ? (followed[0].change === "payoff" ? "An extra payment changed in Actual now pays the loan off: it was taken out of Terms & Schedule and is the payoff" : followed[0].change === "removed" ? "An extra payment was deleted in Actual; it was removed from Terms & Schedule" : "An extra payment changed in Actual; Terms & Schedule was updated to match") : `${followed.length} extra payments changed in Actual; Terms & Schedule was updated to match`);
      }
      setState((s) => ({ phase: syncProblem ? "failed" : "done", error: syncProblem ? `could not get the latest changes from Actual (${syncProblem}); showing what this browser last downloaded` : null, status: status ?? s.status, statusFromCache: status === null && s.statusFromCache, notices: result.notices, driftMaterial: result.driftMaterial, driftExplained: result.driftExplained === true, unscheduled: result.unscheduled ?? [], paymentOptions: result.paymentOptions ?? [], repaymentChoices: result.repaymentChoices ?? [] }));
      void queryClient.invalidateQueries({ queryKey: ["assets-debt", "postings", debtId] });
    } catch (error) {
      // Keep everything already shown; say it may be out of date.
      setState((s) => ({ ...s, phase: "failed", error: error instanceof Error ? error.message : String(error) }));
    } finally {
      running.current = false;
      if (pending.current) {
        pending.current = false;
        void rerun.current?.();
      }
    }
  }, [connection, directory, debt, debtId, from, to, offsetHistories, cacheKey, queryClient, scheduleDirty]);
  useEffect(() => { rerun.current = refresh; }, [refresh]);

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
