import { formatCardDate } from "./displayDates";
import { daysBetween } from "@/lib/financial-models/calendar/dates";
import { formatAmount } from "@/features/assets-debt/lib/money";
import type { Statement } from "./models";
import { paymentDeadline, type Settlement } from "./repayments";

type Line = { text: string; detail?: string; tone: "neutral" | "success" | "attention" | "danger" };
const money = (minor: number) => formatAmount(minor, 2);
const line = (text: string, tone: Line["tone"] = "neutral"): Line => ({ text, tone });

/** Presentation only. All amounts are integer minor units; pending transfers never imply confirmed settlement. */
export function statementPaymentSummary(statement: Statement, payment: Settlement | undefined, today: string, available: boolean) {
  if (!available || !payment || payment.fullRemainingMinor === null || payment.minimumRemainingMinor === null) {
    const reason = !available ? "Refresh activity" : !statement.bankConfirmed ? "Confirm bank values" : "Load payment history";
    return { progress: [line(reason)], timing: [line("Not confirmed")], detail: `${reason} to confirm payment amounts and timing. Missing evidence is not a zero payment.` };
  }
  const balance = Math.max(0, statement.officialBalanceMinor);
  const minimum = statement.minimumDueMinor;
  const excess = Math.max(0, payment.paidMinor - balance);
  const paid = line(`Paid: ${money(payment.paidMinor)}${payment.provisionalMinor ? ` · ${money(payment.provisionalMinor)} pending` : ""}`);
  if (balance === 0 && minimum === 0) return { progress: [paid, line("No payment required"), ...(excess ? [line(`Beyond statement obligation: ${money(excess)}${payment.provisionalMinor ? " (recorded)" : ""}`)] : [])], timing: [line("No payment required")], detail: "This statement requires no payment. Incoming transfers are shown separately from the statement obligation." };
  const minimumProgress = minimum === 0 ? line("No minimum required") : payment.confirmedPaidMinor >= minimum ? line("Minimum met", "success") : payment.minimumRemainingMinor === 0 ? line("Minimum recorded · pending", "attention") : line(`Minimum remaining: ${money(payment.minimumRemainingMinor)}`, statement.dueDate < today ? "danger" : "neutral");
  const fullProgress = payment.fullRemainingMinor > 0 ? line(`Full remaining: ${money(payment.fullRemainingMinor)}`, "attention") : payment.confirmedPaidMinor >= balance ? line(`Paid in full${excess ? ` · beyond obligation ${money(excess)}${payment.provisionalMinor ? " (recorded)" : ""}` : ""}`, "success") : line(`Full recorded · pending${excess ? ` · beyond obligation ${money(excess)}` : ""}`, "attention");
  const milestone = (label: string, threshold: number, confirmedDate: string | null, recordedDate: string | null): Line => {
    if (threshold === 0) return line(`${label}: not required`);
    const date = confirmedDate ?? recordedDate;
    if (date) {
      const late = Math.max(0, daysBetween(statement.dueDate, date));
      const result = `${late ? `${late} ${late === 1 ? "day" : "days"} late` : "on time"}${confirmedDate ? "" : " (pending)"}`;
      const shortDate = formatCardDate(date);
      return { ...line(`${label}: ${shortDate} · ${result}`, !confirmedDate || late ? "attention" : "success"), detail: `${label}: ${shortDate} · ${result}` };
    }
    if (label === "Full" && statement.dueDate < today && payment.confirmedPaidMinor >= minimum) return line("Full: balance carried", "attention");
    if (statement.dueDate < today) { const days = daysBetween(statement.dueDate, today); return line(`${label}: ${days} ${days === 1 ? "day" : "days"} overdue`, label === "Minimum" ? "danger" : "attention"); }
    return line(`${label}: ${paymentDeadline(statement.dueDate, today).toLowerCase()}`);
  };
  return {
    progress: [paid, minimumProgress, fullProgress],
    timing: [milestone("Minimum", minimum, payment.confirmedMinimumPaidDate, payment.minimumPaidDate), milestone("Full", balance, payment.confirmedPaidDate, payment.paidDate), ...(payment.provisionalMinor ? [line("Clearing pending", "attention")] : [])],
    detail: `Recorded payments ${money(payment.paidMinor)}; confirmed ${money(payment.confirmedPaidMinor)}; pending ${money(payment.provisionalMinor)}. Minimum due ${money(minimum)}; full balance ${money(balance)}. Remaining amounts include recorded pending transfers and are provisional until clearing. Payments beyond this statement obligation are not necessarily unused account credit. Dates show when cumulative payments first reached each threshold, not the date of every transfer.`,
  };
}
