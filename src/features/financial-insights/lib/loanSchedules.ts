import type { ConnectionInstance } from "@/store/connection";
import { addMonths } from "@/lib/financial-models/calendar/dates";
import { getDebt, listDebts } from "@/features/assets-debt/lib/debtsApi";
import { projectAfterAnchor, readTrackedLoan, type TrackedLoan } from "@/features/assets-debt/lib/trackedLoan";

/**
 * What a tracked loan will really cost each month, from the schedule the Loans page itself shows. Financial Insights
 * uses Actual's recorded obligations: only a loan tracked against its Actual account, whose schedule reconciles with that
 * account, has a schedule here. An untracked model is never used, and a loan that does not reconcile is unavailable,
 * not estimated. Reads only; nothing is written to Actual.
 */

export type LoanSchedule =
  | { accountId: string; state: "ready"; monthlyMinor: number; payments: number; totalMinor: number }
  | { accountId: string; state: "unavailable"; reason: string };

export type LoanSchedules = {
  schedules: LoanSchedule[];
  /**
   * The ids of the interest and fee lines the Loans tracking recorded for these loans: exactly those rows, not everything
   * that shares their category, so what the loans cost is not counted twice and nothing else is taken out of spending.
   */
  costRowIds: string[];
  /** The same rows, each with the loan it belongs to and whether it is interest or a fee. */
  costRows: CostRowTag[];
};

export type CostRowTag = { id: string; loanAccountId: string; kind: "interest" | "fee" };

const unavailable = (accountId: string, reason: string): LoanSchedule => ({ accountId, state: "unavailable", reason });

/**
 * The cash due over the coming months, spread over the months in which a payment falls: the installment while the loan
 * lasts, and the average where installments change. Only the projection's scheduled payments (including any overdue one the
 * calculation still expects) count.
 */
export function monthlyRepayment(events: readonly { eventType: string; date: string; cashMovementMinor: number }[], until: string): { monthlyMinor: number; payments: number; totalMinor: number } {
  const due = events.filter((e) => (e.eventType === "repayment" || e.eventType === "final-payment") && e.date <= until);
  if (due.length === 0) return { monthlyMinor: 0, payments: 0, totalMinor: 0 };
  const months = new Set(due.map((e) => e.date.slice(0, 7)));
  const total = due.reduce((sum, e) => sum - e.cashMovementMinor, 0);
  return { monthlyMinor: Math.round(total / months.size), payments: due.length, totalMinor: total };
}

/**
 * The interest and fee lines of the installments already recorded in Actual, and, for a loan whose lender charges interest as its
 * own transaction, the rows of the loan account classified as interest charged or as a fee: the scheduled repayment already
 * includes them, so they must not stay in spending as well. Transfers are never cost rows.
 */
export function recordedCostRows(plan: TrackedLoan["plan"], loanAccountId: string): CostRowTag[] {
  const fromSplits: CostRowTag[] = plan.installments.flatMap((installment) => {
    const split = installment.payment?.split;
    if (!split) return [];
    return [
      ...(split.interestLineId ? [{ id: split.interestLineId, loanAccountId, kind: "interest" as const }] : []),
      ...split.feeLineIds.map((id) => ({ id, loanAccountId, kind: "fee" as const })),
    ];
  });
  const charged: CostRowTag[] = plan.ledger.filter((l) => !l.row.transferId && !l.benchMade && (l.type === "interest-charged" || l.type === "fee")).map((l) => ({ id: l.row.id, loanAccountId, kind: l.type === "fee" ? "fee" as const : "interest" as const }));
  const seen = new Set<string>();
  return [...fromSplits, ...charged].filter((tag) => !seen.has(tag.id) && !!seen.add(tag.id));
}

export const recordedCostRowIds = (plan: TrackedLoan["plan"]): string[] => recordedCostRows(plan, "").map((r) => r.id);

/**
 * The schedule of a tracked loan whose plan has been read from Actual: only if it agrees with the loan account, then the
 * Loans page's own projection from the plan's anchor. Pure: the reads happen in `readLoanSchedules`.
 */
export function scheduleFromLoan(accountId: string, loan: TrackedLoan, today: string): LoanSchedule {
  if (!loan.agrees) return unavailable(accountId, "Its schedule does not agree with the loan account in Actual; review it in Loans");
  const until = addMonths(today, 12);
  const projected = projectAfterAnchor(loan, until);
  if (!projected.ok) return unavailable(accountId, projected.reason);
  return { accountId, state: "ready", ...monthlyRepayment(projected.projection.events, until) };
}

export async function readLoanSchedules(connection: ConnectionInstance, input: { budgetSyncId: string; today: string; loanAccountIds: ReadonlySet<string> }): Promise<LoanSchedules> {
  const { budgetSyncId, today, loanAccountIds } = input;
  const result: LoanSchedules = { schedules: [], costRowIds: [], costRows: [] };
  if (loanAccountIds.size === 0) return result;
  const debts = (await listDebts(budgetSyncId)).filter((d) => d.status === "active" && d.liabilityAccountId && loanAccountIds.has(d.liabilityAccountId));
  for (const summary of debts) {
    const accountId = summary.liabilityAccountId!;
    try {
      const read = await readTrackedLoan(connection, await getDebt(summary.id), today);
      if (read.state === "untracked") continue; // its recorded repayments are used instead
      if (read.state === "unavailable") { result.schedules.push(unavailable(accountId, read.reason)); continue; }
      const tagged = recordedCostRows(read.loan.plan, accountId);
      result.costRows.push(...tagged);
      result.costRowIds.push(...tagged.map((r) => r.id));
      result.schedules.push(scheduleFromLoan(accountId, read.loan, today));
    } catch (error) {
      result.schedules.push(unavailable(accountId, error instanceof Error ? error.message : "The loan could not be read"));
    }
  }
  return result;
}
