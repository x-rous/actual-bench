import { daysBetween } from "@/lib/financial-models/calendar/dates";
import { formatAmount } from "@/features/assets-debt/lib/money";
import type { ActivitySnapshot } from "../activity";
import { formatCardDate } from "../displayDates";
import type { Statement, Workspace } from "../models";
import { statementReview, type StatementReview } from "../statements";
import type { StatementPayment } from "./payments";

/** Tones follow §9.13: red only for overdue and errors; green only for completed states. */
export type Tone = "muted" | "neutral" | "info" | "attention" | "success" | "danger";

export type PaymentBadgeKey =
  | "estimate"
  | "starting-point"
  | "unknown"
  | "nothing-to-pay"
  | "due-in"
  | "due-soon"
  | "due-today"
  | "part-paid"
  | "pending"
  | "paid"
  | "covered-with-credits"
  | "settled-with-plan"
  | "paid-late"
  | "minimum-paid"
  | "not-paid"
  | "overdue";

export type PaymentStatus = {
  key: PaymentBadgeKey;
  label: string;
  tone: Tone;
  /** One short secondary line, e.g. "28 Oct · 5 days early" or "3 days overdue". */
  line: string;
  /** The date the badge refers to (paid date, or today when overdue). */
  date: string | null;
  known: boolean;
  paid: boolean;
  late: boolean;
  overdue: boolean;
};

const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

/**
 * Whether a later statement of the same card has been issued. Its balance carries whatever this one
 * left unpaid, so this statement stops counting days overdue and the next one owns the debt.
 */
export function hasLaterStatement(statements: Statement[], statement: Statement) {
  return statements.some((other) => other.cardId === statement.cardId && !other.estimate && other.closingDate > statement.closingDate);
}

/**
 * One ordered rule list → one of the 12 payment badges (§9.13), plus "Payment history
 * incomplete" when the allocation is unknown. Every screen reads this; labels never switch
 * meaning with state.
 */
export function paymentStatus(
  statement: Statement | undefined,
  payment: StatementPayment | undefined,
  today: string,
  startingPoint = false,
  /** A later statement has been issued (see `hasLaterStatement`). */
  superseded = false
): PaymentStatus {
  const base = { date: null, known: false, paid: false, late: false, overdue: false } as const;
  if (!statement) return { ...base, key: "unknown", label: "No statement", tone: "muted", line: "" };
  if (statement.estimate) {
    return { ...base, key: "estimate", label: "Estimate", tone: "muted", line: `Due ${formatCardDate(statement.dueDate)} · estimated` };
  }
  if (startingPoint) return { ...base, key: "starting-point", label: "Starting point", tone: "muted", line: "Tracking starts here", known: true };
  if (!payment?.known || payment.leftToPayMinor === null || payment.minimumLeftMinor === null) {
    return { ...base, key: "unknown", label: "Payment history incomplete", tone: "muted", line: "Load the full payment window" };
  }
  const known = { ...base, known: true };
  const until = daysBetween(today, statement.dueDate);
  const dueLine = until > 0 ? `Due ${formatCardDate(statement.dueDate)} · in ${days(until)}` : until === 0 ? "Due today" : `${days(-until)} overdue`;
  if (payment.amountDueMinor === 0) {
    return { ...known, key: "nothing-to-pay", label: "Nothing to pay", tone: "neutral", line: statement.balanceMinor < 0 ? "Card in credit" : "", paid: true };
  }
  if (payment.leftToPayMinor === 0) {
    const late = Boolean(payment.paidDate && payment.paidDate > statement.dueDate);
    // Part of the bill moved into an instalment plan: settled, but not paid in full (Paid stays real payments).
    if (payment.convertedMinor > 0 && payment.paidMinor < payment.amountDueMinor) {
      return {
        ...known, key: "settled-with-plan", label: late ? "Settled late with a plan" : "Settled with a plan", tone: late ? "attention" : "success",
        line: `${formatAmount(payment.convertedMinor, 2)} moved to a plan`, date: payment.paidDate, paid: true, late,
      };
    }
    const timing = payment.paidDate ? daysBetween(statement.dueDate, payment.paidDate) : 0;
    const line = payment.paidDate
      ? `${formatCardDate(payment.paidDate)} · ${timing > 0 ? `${days(timing)} late` : timing === 0 ? "on due date" : `${days(-timing)} early`}`
      : "";
    return late
      ? { ...known, key: "paid-late", label: "Paid late", tone: "attention", line, date: payment.paidDate, paid: true, late: true }
      : { ...known, key: "paid", label: "Paid in full", tone: "success", line, date: payment.paidDate, paid: true };
  }
  // D14: payments plus credits cover the bill although payments alone don't.
  if (payment.paidMinor + payment.convertedMinor + payment.creditsMinor >= payment.amountDueMinor) {
    return { ...known, key: "covered-with-credits", label: "Covered with credits", tone: "success", line: "Refunds or credits cover the rest", paid: true };
  }
  // CA-7: a pending payment made by the due date is pending, never overdue.
  if (payment.pendingMinor > 0 && (payment.pendingByDue || until >= 0)) {
    return { ...known, key: "pending", label: "Pending", tone: "info", line: payment.pendingByDue ? "Paid on time · clearing" : "Clearing" };
  }
  if (until < 0) {
    if (payment.minimumLeftMinor === 0) {
      const late = Boolean(payment.minimumPaidDate && payment.minimumPaidDate > statement.dueDate);
      return {
        ...known, key: "minimum-paid", label: "Minimum paid", tone: "attention",
        line: late ? "Minimum paid late · balance carried" : "Balance carried", date: payment.minimumPaidDate, late,
      };
    }
    // A missed payment is overdue only until the next statement is issued; that statement's balance
    // already includes it, so it is flagged amber as not paid and no longer asks for attention.
    if (superseded) {
      return { ...known, key: "not-paid", label: "Not paid", tone: "attention", line: "Carried into the next statement", late: true };
    }
    return { ...known, key: "overdue", label: "Overdue", tone: "danger", line: dueLine, date: today, overdue: true };
  }
  if (payment.paidMinor > 0) return { ...known, key: "part-paid", label: "Part paid", tone: "neutral", line: dueLine };
  if (until === 0) return { ...known, key: "due-today", label: "Due today", tone: "attention", line: dueLine };
  if (until <= 7) return { ...known, key: "due-soon", label: "Due soon", tone: "attention", line: dueLine };
  return { ...known, key: "due-in", label: `Due in ${days(until)}`, tone: "neutral", line: `Due ${formatCardDate(statement.dueDate)}` };
}

export type BankMatchKey =
  | "matches"
  | "to-review"
  | "difference"
  | "changed"
  | "needs-previous-balance"
  | "not-entered"
  | "waiting";

export type BankMatch = { key: BankMatchKey; label: string; tone: Tone; line: string; attention: boolean };

/**
 * One of the 6 bank-match badges (§9.13), plus "Waiting for Actual data" before the first read.
 * "Matches bank" is automatic once nothing is undecided and the difference is 0 (D26). A difference is
 * always shown: a stored scope acceptance (A4, retired) no longer hides it.
 */
export function bankMatch(statement: Statement, workspace: Workspace, snapshot: ActivitySnapshot | undefined): BankMatch {
  if (statement.estimate) return { key: "not-entered", label: "Not entered", tone: "muted", line: "Enter the bank figures", attention: true };
  if (!snapshot) {
    return statement.reviewState === "verified"
      ? { key: "matches", label: "Matches bank", tone: "success", line: "From your last review", attention: false }
      : { key: "waiting", label: "Waiting for Actual data", tone: "muted", line: "", attention: false };
  }
  return bankMatchFor(statement, statementReview(statement, workspace, snapshot));
}

export function bankMatchFor(statement: Statement, review: StatementReview): BankMatch {
  if (!review.coverage) return { key: "waiting", label: "Waiting for Actual data", tone: "muted", line: "Load the full period", attention: false };
  if (review.stale && statement.reviewState !== "not_reviewed") {
    return { key: "changed", label: "Changed since review", tone: "attention", line: "Actual activity changed", attention: true };
  }
  if (review.unresolved || review.duplicate) {
    const count = review.unresolved || 1;
    const line = review.duplicate ? "On two statements" : `${count} to decide`;
    return { key: "to-review", label: `To review ${count}`, tone: "attention", line, attention: true };
  }
  if (review.varianceMinor === null) {
    return {
      key: "needs-previous-balance", label: "Needs previous balance", tone: "muted",
      line: review.startingBalanceMinor === null ? "Not reconcilable without a starting balance" : "Plan balance unavailable",
      attention: false,
    };
  }
  if (review.varianceMinor !== 0) {
    return { key: "difference", label: "Difference", tone: "attention", line: differenceLine(review.varianceMinor), attention: true };
  }
  return {
    key: "matches", label: "Matches bank", tone: "success",
    line: "",
    attention: false,
  };
}

const differenceLine = (minor: number) => formatAmount(minor, 2);

/** The one attention predicate behind every count, pill and dot. "Matches bank" never is. */
export function needsAttention(match: BankMatch, status: PaymentStatus) {
  return match.attention || status.overdue;
}
