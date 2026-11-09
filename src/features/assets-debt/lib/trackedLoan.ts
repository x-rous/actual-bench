import { getTransport } from "@/lib/actual";
import type { ConnectionInstance } from "@/store/connection";
import { readAccountDirectory, type AccountDirectory } from "@/lib/assets-debt/actual/ledgerPort";
import { modelFromDetail } from "@/lib/assets-debt/model/buildModel";
import type { DebtDetail } from "@/lib/assets-debt/services/debtConfigService";
import { readOffsetHistories, type OffsetHistorySnapshot } from "@/lib/assets-debt/services/offsetHistoryService";
import { planTracking, trackingAgrees, type TrackingDebt, type TrackingResult } from "@/lib/assets-debt/tracking/plan";
import { explainBlocks } from "@/lib/financial-models/loan/blockMessages";
import { projectDebt, type DebtProjection, type DebtProjectionEvent } from "@/lib/financial-models/loan/projection";
import type { DebtSummary } from "@/lib/assets-debt/services/debtConfigService";
import { summarizeLoanEvents, type LoanSummary } from "@/lib/assets-debt/services/loanSummaryEvents";
import { getDebt } from "./debtsApi";
import { detailToStates, type SimulationState } from "./simulatorModel";
import { trackedHistory } from "./trackedSchedule";
import { getTrackingBundle } from "./trackingApi";
import { readTracking, ruleAccounts } from "./trackingReads";
import { inputFor } from "./useLiveProjection";
import { readWindowStart, trackingDebtOf, trackingDetail } from "./useLoanTracking";

/**
 * A loan tracked in Actual, read and planned the way the Loans page plans it: what really happened from the loan ledger,
 * then the projection from the plan's anchor, so an installment already paid (even early) is not due again. One reader for
 * everything outside the Loans page that needs the same answer (the Loans list, Financial Insights). Reads only.
 */

export type TrackedLoan = {
  debt: TrackingDebt;
  simulation: SimulationState;
  plan: Extract<TrackingResult, { ok: true }>;
  /** What the offset accounts held, read from Actual as the Loans page reads them. */
  histories?: OffsetHistorySnapshot[];
  /** Whether the calculation agrees with the loan account in Actual (the Loans module's own rule). */
  agrees: boolean;
};

export type TrackedLoanRead = { state: "untracked" } | { state: "unavailable"; reason: string } | { state: "ready"; loan: TrackedLoan };

const unavailable = (reason: string): TrackedLoanRead => ({ state: "unavailable", reason });

// Every loan of a budget needs the same account directory: read it once for a few seconds.
const directories = new Map<string, { at: number; read: Promise<AccountDirectory> }>();
function directoryFor(connection: ConnectionInstance, budgetSyncId: string): Promise<AccountDirectory> {
  const key = `${connection.id}:${budgetSyncId}`;
  const known = directories.get(key);
  if (known && Date.now() - known.at < 10_000) return known.read;
  const read = readAccountDirectory(getTransport(connection), budgetSyncId);
  directories.set(key, { at: Date.now(), read });
  read.catch(() => directories.delete(key));
  return read;
}

export async function readTrackedLoan(connection: ConnectionInstance, detail: DebtDetail, today: string): Promise<TrackedLoanRead> {
  const debt = trackingDebtOf(detail);
  if (!debt) return { state: "untracked" };
  const transport = getTransport(connection);
  try {
    const [bundle, directory] = await Promise.all([getTrackingBundle(detail.debt.id), directoryFor(connection, detail.debt.budgetSyncId)]);
    const openAccounts = directory.accounts.filter((a) => !a.closed && !a.offBudget).map((a) => a.id);
    const reads = await readTracking(transport, {
      loanAccountId: debt.liabilityAccountId, from: readWindowStart(debt.trackingStartDueDate), today, sync: false,
      ruleAccountIds: ruleAccounts(bundle.rules, openAccounts, debt.liabilityAccountId),
    });
    if (reads.complete === false) return unavailable("The loan account did not read completely");
    const built = modelFromDetail(trackingDetail(detail, debt.trackingStartDueDate));
    if (!built.ok) return unavailable(built.blocked.message);
    const plan = planTracking({
      debt, model: built.model, today, openingStatement: bundle.openingStatement, anchors: bundle.anchors, accounts: directory.accounts,
      transferPayeeByAccount: reads.transferPayeeByAccount, loanRows: reads.loanRows, bankRows: reads.bankRows, entries: bundle.entries, rules: bundle.rules,
    });
    if (!plan.ok) return unavailable(plan.message);
    const states = detailToStates(detail);
    if (!states) return unavailable("The loan's terms are incomplete");

    const offsets = detail.offsets.filter((o) => o.useActualBalance === true);
    let histories: OffsetHistorySnapshot[] | undefined;
    if (offsets.length > 0) {
      const history = await readOffsetHistories(transport, { accountIds: [...new Set(offsets.map((o) => o.actualAccountId))], asOfDate: today });
      if (!history.ok) return unavailable(history.failures.map((f) => f.message).join(" "));
      // Two links may use the same Actual account: each gets its own copy of that account's history under its own placeholder.
      const byAccount = new Map(history.snapshots.map((snapshot) => [snapshot.accountId, snapshot]));
      histories = offsets.flatMap((o) => { const snapshot = byAccount.get(o.actualAccountId); return snapshot ? [{ ...snapshot, accountId: `offset:${o.id}` }] : []; });
    }
    return { state: "ready", loan: { debt, simulation: states.simulation, plan, histories, agrees: trackingAgrees(plan, debt.toleranceMinor) } };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "The loan could not be read");
  }
}

type Projected = { ok: true; projection: Extract<DebtProjection, { ok: true }> } | { ok: false; reason: string };

function project(loan: Pick<TrackedLoan, "simulation" | "histories" | "debt" | "plan">, mode: "projection" | "contract", to?: string): Projected {
  const input = inputFor(loan.simulation, loan.histories, { mode, at: { startDate: loan.debt.trackingStartDueDate, anchor: loan.plan.anchor } });
  if (!input) return { ok: false, reason: "The loan's terms could not be calculated" };
  const result = projectDebt(to ? { ...input, to } : input);
  return result.ok ? { ok: true, projection: result } : { ok: false, reason: explainBlocks(result.blocked).texts.join(" ") };
}

/** The projection from the plan's anchor: the installments still to come, as the Loans page shows them. */
export const projectAfterAnchor = (loan: Pick<TrackedLoan, "simulation" | "histories" | "debt" | "plan">, to?: string) => project(loan, "projection", to);

/**
 * The whole loan as the Loans page composes it: the contract before the tracking start, what really happened from the
 * ledger, then the projection after the plan's anchor.
 */
export function trackedLoanEvents(loan: TrackedLoan, today: string): { ok: true; events: DebtProjectionEvent[] } | { ok: false; reason: string } {
  const after = project(loan, "projection");
  if (!after.ok) return after;
  const contract = project(loan, "contract");
  if (!contract.ok) return contract;
  const history = trackedHistory(loan.plan, loan.debt.trackingStartDueDate, today);
  return {
    ok: true,
    events: [
      ...contract.projection.events.filter((e) => e.date < history.startDate),
      ...history.events,
      ...after.projection.events.filter((e) => e.date > history.anchor.date),
    ],
  };
}

/**
 * The Loans list's figures for a loan tracked in Actual, from what really happened plus the projection after it, so an
 * installment paid early is counted as paid. Null when the loan is not tracked or its plan cannot be read: the list then
 * keeps showing its stored schedule, labelled as calculated.
 */
export async function trackedLoanSummary(connection: ConnectionInstance, debt: DebtSummary, today: string): Promise<{ ok: true; summary: LoanSummary } | null> {
  if (!debt.trackingStartDueDate || debt.status !== "active" || debt.openingPrincipalMinor === null) return null;
  const read = await readTrackedLoan(connection, await getDebt(debt.id), today);
  if (read.state !== "ready") return null;
  return summaryOfTrackedLoan(read.loan, debt, today);
}

/** `trackedLoanSummary` for a loan that has already been read, so a caller that holds it does not read it again. */
export function summaryOfTrackedLoan(loan: TrackedLoan, debt: DebtSummary, today: string): { ok: true; summary: LoanSummary } | null {
  if (debt.openingPrincipalMinor === null) return null;
  const composed = trackedLoanEvents(loan, today);
  if (!composed.ok) return null;
  return {
    ok: true,
    summary: summarizeLoanEvents(composed.events, { today, forecastFrom: loan.plan.anchor.restartDate, paidOffOn: debt.paidOffOn ?? null, startingPrincipalMinor: debt.openingPrincipalMinor }),
  };
}
