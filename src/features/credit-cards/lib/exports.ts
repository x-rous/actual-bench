import { minorToMajorText } from "@/features/assets-debt/lib/money";
import type { ActivityRow } from "./activity";
import type { StatementRow } from "./derive/cardView";
import type { Statement } from "./models";

/** Amounts are exported as plain decimal text in major units (no currency), so spreadsheets read them as numbers. */
const amount = (minor: number | null | undefined) => (minor == null ? "" : minorToMajorText(minor, 2));

/** A file name from the card name and what is exported, safe on every platform. */
export function exportFileName(cardName: string, what: string, today: string) {
  return `${`${cardName}-${what}-${today}`.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-")}.csv`;
}

/** One row per statement (saved and estimated), newest first, with its payment outcome and bank match. */
export function statementsCsv(rows: readonly StatementRow[]): string[][] {
  const header = ["Period start", "Closing date", "Due date", "Statement balance", "Minimum due", "Amount due",
    "Paid", "Left to pay", "Minimum left", "Payment status", "Bank match", "Estimate"];
  const lines = [...rows]
    .sort((a, b) => b.statement.closingDate.localeCompare(a.statement.closingDate))
    .map(({ statement, payment, status, match }) => [
      statement.periodStart, statement.closingDate, statement.dueDate,
      amount(statement.balanceMinor), amount(statement.minimumDueMinor), amount(payment?.amountDueMinor),
      payment?.known ? amount(payment.paidMinor) : "", amount(payment?.leftToPayMinor), amount(payment?.minimumLeftMinor),
      status.label, statement.estimate ? "" : match.label, statement.estimate ? "Yes" : "No",
    ]);
  return [header, ...lines];
}

export type ExportPayment = { row: ActivityRow; date: string; statement: Statement | undefined };

/** One row per payment or reversal, with the bill it pays and its timing. */
export function paymentsCsv(
  payments: readonly ExportPayment[], from: (row: ActivityRow) => string, timing: (payment: ExportPayment) => string,
): string[][] {
  const header = ["Date", "Actual date", "From", "Notes", "Amount", "Cleared", "Pays statement", "Bill due", "Timing"];
  return [header, ...payments.map((payment) => [
    payment.date, payment.row.date, from(payment.row), payment.row.notes ?? "", amount(payment.row.amountMinor),
    payment.row.cleared === true ? "Yes" : payment.row.cleared === false ? "No" : "",
    payment.statement?.closingDate ?? "", payment.statement?.dueDate ?? "", timing(payment),
  ])];
}
