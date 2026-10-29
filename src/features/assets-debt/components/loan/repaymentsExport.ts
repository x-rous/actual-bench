import type { Installment, LedgerRow } from "@/lib/assets-debt/tracking/plan";
import { ENTRY_LABELS, statusLabel } from "./presentation";

/** The rows of the Repayments table that can be exported (the "before tracking" summary is not a row of data). */
export type ExportRow =
  | { kind: "installment"; inst: Installment }
  | { kind: "event"; ledger: LedgerRow }
  | { kind: "opening"; date: string; amountMinor: number };

export const REPAYMENTS_CSV_HEADER = [
  "Type", "No.", "Due date", "Paid date", "From", "Payee", "Payment", "Principal",
  "Interest in Actual", "Interest calculated by Bench", "Interest difference (Actual minus Bench)", "Balance after", "Status", "Notes",
] as const;

/**
 * The Repayments table as CSV rows, header first. Amounts are plain decimals in the loan's currency (no grouping, no
 * currency code), dates are ISO. The interest difference is Actual's figure minus Bench's calculation, so a negative
 * number means the lender charged less than Bench calculates.
 */
export function repaymentsCsvRows(rows: readonly ExportRow[], options: { digits: number; accountName: (accountId: string) => string }): string[][] {
  const amount = (minor: number | null | undefined) => (minor === null || minor === undefined ? "" : (minor / 10 ** options.digits).toFixed(options.digits));
  const out: string[][] = [[...REPAYMENTS_CSV_HEADER]];
  for (const row of rows) {
    if (row.kind === "installment") {
      const { inst } = row;
      const pays = inst.payment;
      const hasInterest = inst.status !== "missing";
      out.push([
        "Installment", String(inst.no), inst.dueDate, pays?.date ?? "",
        pays ? options.accountName(pays.row.accountId) : "",
        pays ? (pays.kind === "rule" ? pays.row.payeeName ?? "" : "Transfer") : "",
        amount(pays ? pays.amountMinor : inst.status === "upcoming" ? inst.scheduledMinor : null),
        hasInterest ? amount(inst.principalMinor) : "",
        hasInterest ? amount(inst.interestMinor) : "",
        hasInterest ? amount(inst.calculatedInterestMinor) : "",
        hasInterest ? amount(inst.interestMinor - inst.calculatedInterestMinor) : "",
        amount(inst.balanceAfterMinor), statusLabel(inst.status), inst.note ?? pays?.row.notes ?? "",
      ]);
    } else if (row.kind === "event") {
      const { row: tx, type } = row.ledger;
      out.push([ENTRY_LABELS[type], "", "", tx.date, tx.transferId ? tx.payeeName ?? "" : "", tx.transferId ? "Transfer" : tx.payeeName ?? "", amount(Math.abs(tx.amount)), type === "extra-principal" ? amount(tx.amount) : "", "", "", "", "", "", tx.notes ?? ""]);
    } else {
      out.push(["Opening adjustment", "", "", row.date, "", "Loan adjustment", amount(Math.abs(row.amountMinor)), "", "", "", "", "", statusLabel("unrecorded"), "Opening adjustment: Actual's loan account differs from the opening position"]);
    }
  }
  return out;
}

/** "350k-loan-repayments-2026-10-29.csv": the loan's name made safe for a file name. */
export function repaymentsCsvFilename(loanName: string | undefined, today: string): string {
  const slug = (loanName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug ? `${slug}-` : ""}repayments-${today}.csv`;
}
