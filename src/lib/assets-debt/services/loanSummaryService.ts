import type { SqliteDatabase } from "@/lib/app-db/types";
import { getEffectiveDebtAnchor } from "@/lib/app-db/debtAnchorRepository";
import { getDebtDetail } from "./debtConfigService";
import { projectStoredDebt } from "./projectionService";
import type { OffsetHistorySnapshot } from "./offsetHistoryService";

export type LoanSummary = {
  forecastFrom: string;
  paymentsMade: number;
  totalPayments: number;
  next: { date: string; amountMinor: number } | null;
  /** Interest up to today from the calculation. Minor units. */
  interestToDateMinor: number;
  totalInterestMinor: number;
  calculatedBalanceMinor: number;
  payoffDate: string | null;
  regularRepaymentMinor: number | null;
  dueSoonMinor: number;
  dueSoonCount: number;
};

/** Compact overview payload: forecast facts and confirmed history have separate sources. */
export function summarizeStoredLoan(db: SqliteDatabase, id: string, input: { today: string; offsetHistories?: OffsetHistorySnapshot[] }) {
  const detail = getDebtDetail(db, id);
  if (!detail) return { ok: false as const, notFound: true as const };
  const anchor = getEffectiveDebtAnchor(db, id);
  const projected = projectStoredDebt(db, id, { from: "0001-01-01", to: `${Number(input.today.slice(0, 4)) + 60}-12-31`, resolution: "events", offsetHistories: input.offsetHistories }, detail);
  if (!projected.ok) return projected;
  if (!projected.projection.ok) return { ok: false as const, blocked: { code: "invalid-config", message: projected.projection.blocked.map((item) => item.message).join(" ") } };
  const events = projected.projection.events;
  const paidOff = detail.paidOff && detail.paidOff.paidDate <= input.today ? detail.paidOff : null;
  const remaining = paidOff ? [] : events.filter((event) => event.date > input.today);
  const payments = remaining.filter((event) => event.eventType === "repayment" || event.eventType === "final-payment");
  // Interest and repayments to date from the calculation up to today (design spec 06 §7.7); the Repayments tab, which
  // reads Actual, shows which of them are recorded there.
  const past = paidOff ? events : events.filter((event) => event.date <= input.today);
  const made = past.filter((event) => event.eventType === "repayment" || event.eventType === "final-payment").length;
  const interest = past.reduce((sum, event) => sum + event.interestMinor, 0);
  const soon = new Date(Date.parse(`${input.today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const due = payments.filter((payment) => payment.date <= soon);
  const forecastInterest = remaining.reduce((sum, event) => sum + event.interestMinor, 0);
  const summary: LoanSummary = {
    forecastFrom: anchor?.anchorDate ?? projected.model.terms.openingDate,
    paymentsMade: made,
    totalPayments: made + payments.length,
    next: payments[0] ? { date: payments[0].date, amountMinor: -payments[0].cashMovementMinor } : null,
    interestToDateMinor: interest,
    totalInterestMinor: interest + forecastInterest,
    calculatedBalanceMinor: paidOff ? 0 : events.filter((event) => event.date <= input.today).at(-1)?.balanceAfterMinor ?? anchor?.principalMinor ?? projected.model.terms.openingPrincipalMinor,
    payoffDate: paidOff?.paidDate ?? events.find((event) => event.balanceBeforeMinor > 0 && event.balanceAfterMinor === 0 && event.eventType !== "interest-charge")?.date ?? null,
    regularRepaymentMinor: payments[0] ? -payments[0].cashMovementMinor : null,
    dueSoonMinor: due.reduce((sum, event) => sum - event.cashMovementMinor, 0), dueSoonCount: due.length,
  };
  return { ok: true as const, summary };
}
