import { formatCardDate } from "./displayDates";
import { daysBetween } from "@/lib/financial-models/calendar/dates";
import { formatAmount } from "@/features/assets-debt/lib/money";
import type { ActivitySnapshot } from "./activity";
import { statementReview } from "./statements";
import type { Statement, Workspace } from "./models";
import { paymentDeadline, type Settlement } from "./repayments";

import { paymentTarget, paymentTargetRemaining } from "./paymentTargets";

type Line = { text: string; detail?: string; tone: "neutral" | "success" | "attention" | "danger" };
const money = (minor: number) => formatAmount(minor, 2);
const line = (text: string, tone: Line["tone"] = "neutral"): Line => ({ text, tone });

/** Integer minor units. Confirmed settlement is independent of pending recorded transfers. */
export function statementPaymentSummary(statement: Statement, payment: Settlement | undefined, today: string, available: boolean) {
  if (!available || !payment || payment.fullRemainingMinor === null || payment.minimumRemainingMinor === null) {
    const reason = !available ? "Refresh activity" : !statement.bankConfirmed ? "Confirm bank values" : "Load payment history";
    return { progress: [line(reason)], timing: [line("Not confirmed")], detail: `${reason} to confirm payment amounts and timing. Missing evidence is not a zero payment.` };
  }
  const balance = paymentTarget(statement), minimum = statement.minimumDueMinor;
  const cashback = payment.confirmedCreditMinor ?? payment.confirmedCashbackMinor ?? 0;
  const pendingCashback = payment.provisionalCreditMinor ?? payment.provisionalCashbackMinor ?? 0;
  const fullRemaining = paymentTargetRemaining(statement, payment.confirmedPaidMinor);
  const minRemaining = Math.max(0, minimum - payment.confirmedPaidMinor);
  const excess = Math.max(0, payment.confirmedPaidMinor - balance);
  const paid = line(`Paid: ${money(payment.confirmedPaidMinor)}${payment.provisionalMinor ? ` · pending ${money(payment.provisionalMinor)}` : ""}`);
  const dateLine = (label: string, date: string): Line => {
    const days = Math.max(0, daysBetween(statement.dueDate, date));
    return line(`${label}: ${formatCardDate(date)} · ${days ? `${days} ${days === 1 ? "day" : "days"} late` : "on time"}`, days ? "attention" : "success");
  };
  const minimumDelay = payment.confirmedMinimumPaidDate ? Math.max(0, daysBetween(statement.dueDate, payment.confirmedMinimumPaidDate)) : null;
  const detail = `Credits confirmed ${money(cashback)}; pending ${money(pendingCashback)}. Credits reduce the balance; they don’t count toward the minimum. Recorded payments ${money(payment.paidMinor)}; confirmed ${money(payment.confirmedPaidMinor)}; pending ${money(payment.provisionalMinor)}. Minimum due ${money(minimum)}; Total Payment Due ${money(balance)}; statement balance ${money(statement.officialBalanceMinor)}. To pay deducts confirmed payments only. Credits reduce Total owed, not the issued payment target or minimum. Minimum timing: ${minimumDelay === null ? "not confirmed" : minimumDelay > 0 ? `${minimumDelay} days late` : "on time"}. Minimum reached ${payment.confirmedMinimumPaidDate ? formatCardDate(payment.confirmedMinimumPaidDate) : "not yet"}; full reached ${payment.confirmedPaidDate ? formatCardDate(payment.confirmedPaidDate) : "not yet"}. Pending threshold dates: minimum ${payment.minimumPaidDate ? formatCardDate(payment.minimumPaidDate) : "not reached"}; full ${payment.paidDate ? formatCardDate(payment.paidDate) : "not reached"}. Recorded excess ${money(Math.max(0, payment.paidMinor - balance))} may include pending transfers. Payments beyond the statement obligation are not necessarily unused account credit. Dates identify cumulative thresholds, not every transfer.`;
  if (balance === 0) return { progress: [line(statement.officialBalanceMinor < 0 ? `Card credit: ${money(-statement.officialBalanceMinor)}` : "No payment required"), ...(payment.paidMinor ? [paid] : [])], timing: [line("No payment required")], detail };
  if (fullRemaining === 0 && minRemaining > 0) return { progress: [paid, line(`Credits: ${money(cashback)}`), line(`Minimum due: ${money(minRemaining)}`, "attention")], timing: [line(statement.dueDate < today ? "Minimum overdue" : paymentDeadline(statement.dueDate, today), statement.dueDate < today ? "danger" : "neutral")], detail };
  if (fullRemaining === 0) return {
    progress: [paid, ...(cashback || pendingCashback ? [line(`${payment.confirmedCreditMinor !== payment.confirmedCashbackMinor ? "Credits" : "Cashback"}: ${money(cashback)}${pendingCashback ? ` · pending ${money(pendingCashback)}` : ""}`)] : []), line(`${balance < Math.max(0, statement.officialBalanceMinor) ? "Paid this month" : "Paid in full"}${excess ? ` · excess ${money(excess)}` : ""}`, "success")],
    timing: [(balance === Math.max(0, statement.officialBalanceMinor) ? payment.confirmedPaidDate : payment.confirmedTargetPaidDate) ? dateLine("Paid", (balance === Math.max(0, statement.officialBalanceMinor) ? payment.confirmedPaidDate : payment.confirmedTargetPaidDate)!) : line("Payment date unavailable")], detail,
  };
  const pending = payment.provisionalMinor > 0;
  const awaitingFull = pending && payment.paidMinor >= balance;
  const minMet = minRemaining === 0;
  const minimumLine = minimum === 0 ? line("No minimum required") : minMet ? line("Minimum met", "success") : line(`Minimum due: ${money(minRemaining)}`, statement.dueDate < today ? "danger" : "neutral");
  let timing: Line[];
  if (awaitingFull) timing = [line("Awaiting clearance", "attention")];
  else if (minimum > 0 && minMet && payment.confirmedMinimumPaidDate) timing = [dateLine("Minimum paid", payment.confirmedMinimumPaidDate), line(statement.dueDate < today ? "Balance carried" : `Balance ${paymentDeadline(statement.dueDate, today).toLowerCase()}`, "attention")];
  else timing = [statement.dueDate < today ? line(`${minimum > 0 ? "Minimum" : "Balance"}: ${daysBetween(statement.dueDate, today)} days overdue`, minimum > 0 ? "danger" : "attention") : line(paymentDeadline(statement.dueDate, today)), ...(pending ? [line("Awaiting clearance", "attention")] : [])];
  return { progress: [line(`${paid.text}${cashback || pendingCashback ? ` · ${payment.confirmedCreditMinor !== payment.confirmedCashbackMinor ? "credits" : "cashback"} ${money(cashback)}${pendingCashback ? ` (${money(pendingCashback)} pending)` : ""}` : ""}`), line(`Remaining: ${money(fullRemaining)}`, "attention"), minimumLine], timing, detail };
}

export type TimingState = "on-time" | "late" | "partial" | "overdue" | "pending" | "upcoming" | "unknown";
export type StatementOutcome = {
  label: string; countdown: string; tone: "neutral" | "success" | "attention" | "danger" | "info";
  timing: string; marker: TimingState; date: string | null; detail: string;
  paid: boolean; late: boolean; overdue: boolean; carried: boolean; known: boolean;
};

/** Presentation only: confirmed amounts and historical thresholds come from the settlement model. */
export function statementOutcome(statement: Statement | undefined, payment: Settlement | undefined, today: string, available: boolean, baseline = false): StatementOutcome {
  const summary = statement ? statementPaymentSummary(statement, payment, today, available) : null;
  const result: StatementOutcome = { label: "Payment history incomplete", countdown: "", tone: "neutral", timing: "Load payment history", marker: "unknown", date: null, detail: statement && summary ? `Due ${formatCardDate(statement.dueDate)}. ${summary.detail}` : "Confirm a bank statement to track payments", paid: false, late: false, overdue: false, carried: false, known: false };
  if (!statement) return { ...result, label: available ? "Confirm bank values" : "Refresh needed", timing: available ? "Confirm bank values" : "Refresh payment history" };
  if (baseline) return { ...result, label: "Starting point", timing: "Opening balance", known: true, detail: "Opening balance used as the starting point for tracked statements. This is not a payment obligation." };
  if (!statement.bankConfirmed) return { ...result, label: "Estimated", timing: `Due ${formatCardDate(statement.dueDate)} · estimated` };
  if (!available) return { ...result, label: "Payment data unavailable", timing: "Refresh payment history" };
  if (!payment || payment.fullRemainingMinor == null || payment.minimumRemainingMinor == null) return result;
  const days = daysBetween(today, statement.dueDate);
  const fullRemaining = paymentTargetRemaining(statement, payment.confirmedPaidMinor);
  const minimumRemaining = Math.max(0, statement.minimumDueMinor - payment.confirmedPaidMinor);
  const pending = payment.provisionalMinor > 0;
  const standardTarget = paymentTarget(statement) === Math.max(0, statement.officialBalanceMinor);
  const targetDate = standardTarget ? payment.confirmedPaidDate : payment.confirmedTargetPaidDate ?? null;
  const targetByDue = standardTarget ? payment.fullByDue : payment.targetByDue;
  const targetCarry = payment.targetCarriedAtDueMinor;
  const dayCount = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;
  const dueText = `Due ${formatCardDate(statement.dueDate)} · ${days > 0 ? `in ${dayCount(days)}` : days === 0 ? "today" : `${dayCount(-days)} overdue`}`;
  const detail = `${result.detail} Balance remaining at due date: ${payment.carriedAtDueMinor == null ? "unknown" : formatAmount(payment.carriedAtDueMinor, 2)}. To pay after confirmed payments: ${formatAmount(fullRemaining, 2)}.`;
  const countdown = days > 0 ? `in ${dayCount(days)}` : days === 0 ? "today" : `${dayCount(-days)} overdue`;
  const known = { ...result, known: true, detail, countdown, carried: (targetCarry ?? 0) > 0 };
  if (paymentTarget(statement) === 0) return { ...known, countdown: "", label: statement.officialBalanceMinor < 0 ? "Card credit" : "No payment required", timing: "No payment required" };
  if (fullRemaining === 0 && minimumRemaining === 0) {
    const date = targetDate;
    const late = Boolean(date && date > statement.dueDate || targetByDue === false || known.carried);
    const delay = date ? Math.max(0, daysBetween(statement.dueDate, date)) : null;
    const label = paymentTarget(statement) < Math.max(0, statement.officialBalanceMinor) && payment.confirmedPaidMinor < statement.officialBalanceMinor ? late ? "Paid this month · late" : "Paid this month" : late ? "Paid in full · late" : "Paid in full";
    return { ...known, label, countdown: "", paid: true, late, tone: late ? "attention" : date ? "success" : "neutral", marker: late ? "late" : date ? "on-time" : "unknown", date,
      timing: date ? `${formatCardDate(date)} · ${delay ? `${dayCount(delay)} late` : late ? "after due date" : "on time"}` : "Timing unknown" };
  }
  if (minimumRemaining > 0 && days < 0) return { ...known, label: "Minimum overdue", tone: "danger", marker: "overdue", overdue: true, date: today,
    timing: `${dayCount(-days)} overdue · ${pending ? "clearance pending" : payment.confirmedPaidMinor > 0 ? "minimum unpaid" : "unpaid"}` };
  if (fullRemaining === 0 && minimumRemaining > 0) return { ...known, label: "Minimum unpaid", tone: "attention", marker: "upcoming", timing: `Minimum unpaid · due ${formatCardDate(statement.dueDate)}` };
  const minimumDate = statement.minimumDueMinor > 0 ? payment.confirmedMinimumPaidDate : null;
  if (minimumRemaining === 0 && minimumDate) {
    const late = minimumDate > statement.dueDate || payment.minimumByDue === false;
    const delay = Math.max(0, daysBetween(statement.dueDate, minimumDate));
    return { ...known, label: late ? "Minimum paid late" : days < 0 ? "Minimum paid · carried" : "Minimum paid", late, tone: days < 0 || late ? "attention" : "neutral", marker: late ? "late" : "partial", date: minimumDate,
      timing: `${formatCardDate(minimumDate)} · ${delay ? `${dayCount(delay)} late` : "on time"}` };
  }
  if (days < 0) return { ...known, label: "Balance carried", tone: "attention", marker: "overdue", date: today, timing: `${dayCount(-days)} past due · balance unpaid` };
  if (pending) {
    const recordedCoverage = payment.paidMinor;
    const coversFull = recordedCoverage >= paymentTarget(statement);
    return { ...known, label: coversFull ? "Clearing pending" : "Part payment pending", tone: "attention", marker: "pending", date: payment.paidDate,
      timing: coversFull ? `Clearing pending · due ${formatCardDate(statement.dueDate)}` : `${money(fullRemaining)} due · part pending` };
  }
  if (payment.confirmedPaidMinor > 0) return { ...known, label: "Part paid", tone: "neutral", marker: "partial", timing: dueText };
  return { ...known, label: days === 0 ? "Due today" : days <= 7 ? "Due soon" : "Payment due", tone: days <= 7 ? "attention" : "info", marker: "upcoming", timing: dueText };
}


/** An empty, confirmed zero opening anchor is a starting point, not a payment obligation. */
export function isStartingPoint(statement: Statement | undefined, workspace: Workspace, snapshot: ActivitySnapshot | undefined, available: boolean) {
  if (!statement?.openingAnchor || !statement.bankConfirmed || statement.officialBalanceMinor !== 0 || statement.minimumDueMinor !== 0 || !snapshot || !available) return false;
  const review = statementReview(statement, workspace, snapshot);
  return review.coverage && !review.unresolved && !review.duplicate && !review.memberships.some((entry) => entry.decision === "included");
}
