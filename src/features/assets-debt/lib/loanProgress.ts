import type { DebtProjectionEvent } from "@/lib/financial-models/loan/projection";
import { headline } from "./results";

/**
 * Where a loan stands today, from its projection (rev 4 loan cards). Pure: the same events the
 * Schedule shows, split at today. Scheduled payments are the repayment and final-payment events;
 * interest so far is the interest of every event up to today, so it adds up with the Schedule's
 * total interest.
 */
export type LoanProgress = {
  totalPayments: number;
  paymentsMade: number;
  next: { date: string; amountMinor: number } | null;
  interestToDateMinor: number;
  totalInterestMinor: number;
  /** The calculated balance after the last event up to today. */
  calculatedBalanceMinor: number;
  payoffDate: string | null;
  regularRepaymentMinor: number | null;
};

const SCHEDULED = new Set(["repayment", "final-payment"]);

export function loanProgress(events: readonly DebtProjectionEvent[], today: string, openingPrincipalMinor: number): LoanProgress {
  const head = headline(events);
  const payments = events.filter((e) => SCHEDULED.has(e.eventType));
  const upcoming = payments.find((e) => e.date > today) ?? null;
  const past = events.filter((e) => e.date <= today);
  return {
    totalPayments: payments.length,
    paymentsMade: payments.filter((e) => e.date <= today).length,
    next: upcoming ? { date: upcoming.date, amountMinor: -upcoming.cashMovementMinor } : null,
    interestToDateMinor: past.reduce((sum, e) => sum + e.interestMinor, 0),
    totalInterestMinor: head.totalInterestMinor,
    calculatedBalanceMinor: past.length ? past[past.length - 1].balanceAfterMinor : openingPrincipalMinor,
    payoffDate: head.payoffDate,
    regularRepaymentMinor: head.regularRepaymentMinor,
  };
}

/** Share of the opening principal paid off, 0 to 100, from a remaining balance. */
export function percentPaid(openingPrincipalMinor: number, remainingMinor: number): number {
  if (openingPrincipalMinor <= 0) return 0;
  return Math.min(100, Math.max(0, ((openingPrincipalMinor - remainingMinor) / openingPrincipalMinor) * 100));
}
