/** Convert reviewed PDF proposals into the normalized reconciliation model. */

import type { StatementRow } from "../types";
import {
  fingerprintRow,
  periodFor,
  totalsFor,
  type NormalizedStatement,
  type StatementRowError,
} from "./normalize";
import { parsePdfMoneyToMinorUnits, type PdfTransactionProposal } from "./pdf";

export type ReviewedPdfTransaction = Pick<
  PdfTransactionProposal,
  | "sourceRowNumber"
  | "transactionDate"
  | "postedDate"
  | "importDate"
  | "description"
  | "amount"
  | "raw"
>;

/**
 * Rows enter this boundary with one signed amount and one explicit import date.
 * The review screen validates them first; these checks keep future callers from
 * turning an unresolved parser proposal into reconciliation data.
 */
export function normalizeReviewedPdfStatement(
  transactions: ReviewedPdfTransaction[],
  makeId: (index: number) => string
): NormalizedStatement {
  const rows: StatementRow[] = [];
  const errors: StatementRowError[] = [];

  transactions.forEach((transaction, index) => {
    const amount = parsePdfMoneyToMinorUnits(transaction.amount);
    const cells = [
      transaction.importDate ?? "",
      transaction.description,
      transaction.amount,
    ];

    if (!transaction.importDate) {
      errors.push({
        sourceRowNumber: transaction.sourceRowNumber,
        cells,
        reason: "unparseable-date",
        detail: "Enter a valid import date.",
      });
      return;
    }
    if (!transaction.description.trim()) {
      errors.push({
        sourceRowNumber: transaction.sourceRowNumber,
        cells,
        reason: "missing-column",
        detail: "Enter a description.",
      });
      return;
    }
    if (amount === null || amount === 0) {
      errors.push({
        sourceRowNumber: transaction.sourceRowNumber,
        cells,
        reason: "unparseable-amount",
        detail: "Enter a non-zero signed amount.",
      });
      return;
    }

    rows.push({
      id: makeId(index),
      sourceRowNumber: transaction.sourceRowNumber,
      postedDate: transaction.importDate,
      amount,
      importedPayee: transaction.description.trim(),
      // Keep the secondary bank date available for review/audit. The selected
      // import date remains `postedDate`, which is what matching consumes.
      transactionDate:
        transaction.transactionDate && transaction.transactionDate !== transaction.importDate
          ? transaction.transactionDate
          : transaction.postedDate && transaction.postedDate !== transaction.importDate
            ? transaction.postedDate
            : undefined,
      raw: transaction.raw,
      fingerprint: fingerprintRow(transaction.raw.lines, transaction.sourceRowNumber),
    });
  });

  return { rows, errors, totals: totalsFor(rows), period: periodFor(rows) };
}
