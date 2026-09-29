import type { ModelEvent } from "./model";

/**
 * Loan receivables (FR-121): money lent out, modelled as an asset.
 *
 * The same engines run the arithmetic; only the direction reverses. A
 * repayment the borrower makes is cash received, splitting into a return of
 * principal (reducing the receivable) and interest income.
 */

export const RECEIVABLE_VERSION = "receivable@1";

export type ReceivableEvent = {
  date: string;
  type: ModelEvent["type"];
  /** Signed from the lender's side: money received is positive. */
  cashReceivedMinor: number;
  principalReturnMinor: number;
  interestIncomeMinor: number;
  feeIncomeMinor: number;
  receivableBeforeMinor: number;
  receivableAfterMinor: number;
};

export function toReceivableEvents(events: readonly ModelEvent[]): ReceivableEvent[] {
  return events.map((e) => {
    const line = (kind: string) => e.lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amountMinor, 0);
    const paid = e.type === "repayment" || e.type === "final-payment" || e.type === "extra-repayment" || e.type === "balloon";
    return {
      date: e.date,
      type: e.type,
      cashReceivedMinor: -e.cashMovementMinor,
      principalReturnMinor: paid ? line("principal") : 0,
      interestIncomeMinor: paid ? line("interest") : 0,
      feeIncomeMinor: paid ? e.feesMinor : 0,
      receivableBeforeMinor: e.balanceBeforeMinor,
      receivableAfterMinor: e.balanceAfterMinor,
    };
  });
}
