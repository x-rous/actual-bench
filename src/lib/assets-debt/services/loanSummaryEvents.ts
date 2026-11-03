import { addMonths } from "@/lib/financial-models/calendar/dates";
import type { DebtProjectionEvent } from "@/lib/financial-models/loan/projection";

/**
 * What the Loans list shows for one loan, worked out from its dated events. Pure: the server builds the events from the
 * stored schedule, and a loan tracked in Actual builds them from what really happened plus the projection after it, so one
 * set of rules answers "how many payments are left" either way.
 */
export type LoanSummary = {
  forecastFrom: string;
  paymentsMade: number;
  totalPayments: number;
  next: { date: string; amountMinor: number } | null;
  /** Interest through today: calculated from the schedule, or recorded where the loan is tracked in Actual. Minor units. */
  interestToDateMinor: number;
  /** Projected interest after today through the next 12 calendar months. Minor units. */
  interestNext12MonthsMinor: number;
  totalInterestMinor: number;
  calculatedBalanceMinor: number;
  payoffDate: string | null;
  regularRepaymentMinor: number | null;
  dueSoonMinor: number;
  dueSoonCount: number;
};

/** The date the balance last reached zero, only when it ends at zero: a loan drawn on again after reaching zero is not paid off. */
function lastPayoff(events: readonly DebtProjectionEvent[]): string | null {
  if (events.length === 0 || events[events.length - 1].balanceAfterMinor !== 0) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.balanceBeforeMinor > 0 && event.balanceAfterMinor === 0 && event.eventType !== "interest-charge") return event.date;
  }
  return null;
}

const isRepayment = (event: DebtProjectionEvent) => event.eventType === "repayment" || event.eventType === "final-payment";

export function summarizeLoanEvents(
  events: readonly DebtProjectionEvent[],
  input: { today: string; forecastFrom: string; paidOffOn: string | null; startingPrincipalMinor: number }
): LoanSummary {
  const { today } = input;
  const paidOff = input.paidOffOn && input.paidOffOn <= today ? input.paidOffOn : null;
  const remaining = paidOff ? [] : events.filter((event) => event.date > today);
  const payments = remaining.filter(isRepayment);
  const past = paidOff ? events : events.filter((event) => event.date <= today);
  const made = past.filter(isRepayment).length;
  const interest = past.reduce((sum, event) => sum + event.interestMinor, 0);
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const next12Months = addMonths(today, 12);
  const due = payments.filter((payment) => payment.date <= soon);
  const forecastInterest = remaining.reduce((sum, event) => sum + event.interestMinor, 0);
  const interestNext12Months = remaining.filter((event) => event.date <= next12Months).reduce((sum, event) => sum + event.interestMinor, 0);
  return {
    forecastFrom: input.forecastFrom,
    paymentsMade: made,
    totalPayments: made + payments.length,
    next: payments[0] ? { date: payments[0].date, amountMinor: -payments[0].cashMovementMinor } : null,
    interestToDateMinor: interest,
    interestNext12MonthsMinor: interestNext12Months,
    totalInterestMinor: interest + forecastInterest,
    calculatedBalanceMinor: paidOff ? 0 : events.filter((event) => event.date <= today).at(-1)?.balanceAfterMinor ?? input.startingPrincipalMinor,
    payoffDate: paidOff ?? lastPayoff(events),
    regularRepaymentMinor: payments[0] ? -payments[0].cashMovementMinor : null,
    dueSoonMinor: due.reduce((sum, event) => sum - event.cashMovementMinor, 0),
    dueSoonCount: due.length,
  };
}
