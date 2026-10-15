import { formatCardDate } from "./displayDates";
import { daysBetween } from "@/lib/financial-models/calendar/dates";
import { formatAmount } from "@/features/assets-debt/lib/money";
import type { Statement } from "./models";
import { paymentDeadline, type Settlement } from "./repayments";

type Line = { text: string; detail?: string; tone: "neutral" | "success" | "attention" | "danger" };
const money = (minor: number) => formatAmount(minor, 2);
const line = (text: string, tone: Line["tone"] = "neutral"): Line => ({ text, tone });

/** Integer minor units. Confirmed settlement is independent of pending recorded transfers. */
export function statementPaymentSummary(statement: Statement, payment: Settlement | undefined, today: string, available: boolean) {
  if (!available || !payment || payment.fullRemainingMinor === null || payment.minimumRemainingMinor === null) {
    const reason = !available ? "Refresh activity" : !statement.bankConfirmed ? "Confirm bank values" : "Load payment history";
    return { progress: [line(reason)], timing: [line("Not confirmed")], detail: `${reason} to confirm payment amounts and timing. Missing evidence is not a zero payment.` };
  }
  const balance = Math.max(0, statement.officialBalanceMinor), minimum = statement.minimumDueMinor;
  const cashback = payment.confirmedCreditMinor ?? payment.confirmedCashbackMinor ?? 0;
  const pendingCashback = payment.provisionalCreditMinor ?? payment.provisionalCashbackMinor ?? 0;
  const fullRemaining = Math.max(0, balance - payment.confirmedPaidMinor - cashback);
  const minRemaining = Math.max(0, minimum - payment.confirmedPaidMinor);
  const excess = Math.max(0, payment.confirmedPaidMinor - balance);
  const paid = line(`Paid: ${money(payment.confirmedPaidMinor)}${payment.provisionalMinor ? ` · pending ${money(payment.provisionalMinor)}` : ""}`);
  const dateLine = (label: string, date: string): Line => {
    const days = Math.max(0, daysBetween(statement.dueDate, date));
    return line(`${label}: ${formatCardDate(date)} · ${days ? `${days} ${days === 1 ? "day" : "days"} late` : "on time"}`, days ? "attention" : "success");
  };
  const minimumDelay = payment.confirmedMinimumPaidDate ? Math.max(0, daysBetween(statement.dueDate, payment.confirmedMinimumPaidDate)) : null;
  const detail = `Credits confirmed ${money(cashback)}; pending ${money(pendingCashback)}. Credits reduce the balance; they don’t count toward the minimum. Recorded payments ${money(payment.paidMinor)}; confirmed ${money(payment.confirmedPaidMinor)}; pending ${money(payment.provisionalMinor)}. Minimum due ${money(minimum)}; full balance ${money(balance)}. Full remaining deducts confirmed payments and credits; minimum remaining deducts payments only. Minimum timing: ${minimumDelay === null ? "not confirmed" : minimumDelay > 0 ? `${minimumDelay} days late` : "on time"}. Minimum reached ${payment.confirmedMinimumPaidDate ? formatCardDate(payment.confirmedMinimumPaidDate) : "not yet"}; full reached ${payment.confirmedPaidDate ? formatCardDate(payment.confirmedPaidDate) : "not yet"}. Pending threshold dates: minimum ${payment.minimumPaidDate ? formatCardDate(payment.minimumPaidDate) : "not reached"}; full ${payment.paidDate ? formatCardDate(payment.paidDate) : "not reached"}. Recorded excess ${money(Math.max(0, payment.paidMinor - balance))} may include pending transfers. Payments beyond the statement obligation are not necessarily unused account credit. Dates identify cumulative thresholds, not every transfer.`;
  if (balance === 0) return { progress: [line(statement.officialBalanceMinor < 0 ? `Card credit: ${money(-statement.officialBalanceMinor)}` : "No payment required"), ...(payment.paidMinor ? [paid] : [])], timing: [line("No payment required")], detail };
  if (fullRemaining === 0 && minRemaining > 0 && cashback > 0) return { progress: [paid, line(`Credits: ${money(cashback)}`), line(`Minimum due: ${money(minRemaining)}`, "attention")], timing: [line(statement.dueDate < today ? "Minimum overdue" : paymentDeadline(statement.dueDate, today), statement.dueDate < today ? "danger" : "neutral")], detail };
  if (fullRemaining === 0) return {
    progress: [paid, ...(cashback || pendingCashback ? [line(`${payment.confirmedCreditMinor !== payment.confirmedCashbackMinor ? "Credits" : "Cashback"}: ${money(cashback)}${pendingCashback ? ` · pending ${money(pendingCashback)}` : ""}`)] : []), line(`${cashback ? "Settled" : "Paid in full"}${excess ? ` · excess ${money(excess)}` : ""}`, "success")],
    timing: [payment.confirmedPaidDate ? dateLine(cashback ? "Settled" : "Paid", payment.confirmedPaidDate) : line("Payment date unavailable")], detail,
  };
  const pending = payment.provisionalMinor > 0 || pendingCashback > 0;
  const awaitingFull = pending && payment.paidMinor + (payment.creditMinor ?? payment.cashbackMinor ?? 0) >= balance;
  const minMet = minRemaining === 0;
  const minimumLine = minimum === 0 ? line("No minimum required") : minMet ? line("Minimum met", "success") : line(`Minimum due: ${money(minRemaining)}`, statement.dueDate < today ? "danger" : "neutral");
  let timing: Line[];
  if (awaitingFull) timing = [line("Awaiting clearance", "attention")];
  else if (minimum > 0 && minMet && payment.confirmedMinimumPaidDate) timing = [dateLine("Minimum paid", payment.confirmedMinimumPaidDate), line(statement.dueDate < today ? "Balance carried" : `Balance ${paymentDeadline(statement.dueDate, today).toLowerCase()}`, "attention")];
  else timing = [statement.dueDate < today ? line(`${minimum > 0 ? "Minimum" : "Balance"}: ${daysBetween(statement.dueDate, today)} days overdue`, minimum > 0 ? "danger" : "attention") : line(paymentDeadline(statement.dueDate, today)), ...(pending ? [line("Awaiting clearance", "attention")] : [])];
  return { progress: [line(`${paid.text}${cashback || pendingCashback ? ` · ${payment.confirmedCreditMinor !== payment.confirmedCashbackMinor ? "credits" : "cashback"} ${money(cashback)}${pendingCashback ? ` (${money(pendingCashback)} pending)` : ""}` : ""}`), line(`Remaining: ${money(fullRemaining)}`, "attention"), minimumLine], timing, detail };
}

/** One display contract for timing and amount exceptions across lists, tiles and overview. */
export function paymentDisplay(statement: Statement | undefined, payment: Settlement | undefined, today: string, available: boolean) {
  const fallback = { label: available ? "Confirm bank values" : "Refresh needed", tone: "neutral" as const, countdown: "" };
  if (!statement || !statement.bankConfirmed || !available || payment?.fullRemainingMinor == null) return fallback;
  const days = daysBetween(today, statement.dueDate);
  const countdown = days > 0 ? `in ${days} ${days === 1 ? "day" : "days"}` : days === 0 ? "today" : `${-days} ${days === -1 ? "day" : "days"} overdue`;
  const remaining = Math.max(0, statement.officialBalanceMinor - payment.confirmedPaidMinor - (payment.confirmedCreditMinor ?? payment.confirmedCashbackMinor ?? 0));
  const minimum = Math.max(0, statement.minimumDueMinor - payment.confirmedPaidMinor);
  if (statement.officialBalanceMinor <= 0) return { label: statement.officialBalanceMinor < 0 ? "Card credit" : "No payment required", tone: "neutral" as const, countdown: "" };
  if (remaining === 0 && minimum === 0) return { label: payment.confirmedPaidMinor >= statement.officialBalanceMinor ? "Paid in full" : "Balance covered by credits", tone: "success" as const, countdown: "" };
  if (minimum > 0 && days < 0) return { label: "Minimum overdue", tone: "danger" as const, countdown };
  if (remaining === 0) return { label: "Minimum unpaid", tone: "attention" as const, countdown };
  if (days < 0) return { label: "Balance carried", tone: "attention" as const, countdown };
  return { label: days > 7 ? `Due in ${days} days` : days === 0 ? "Due today" : "Due soon", tone: days > 7 ? "info" as const : "attention" as const, countdown };
}
