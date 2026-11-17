/** Convert reviewed PDF proposals into the normalized reconciliation model. */

import type { StatementRow } from "../types";
import {
  fingerprintRow,
  periodFor,
  totalsFor,
  type NormalizedStatement,
  type StatementClosingBalance,
  type StatementRowError,
} from "./normalize";
import { parsePdfMoneyToMinorUnits, type PdfStatementParseResult, type PdfTransactionProposal } from "./pdf";

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
  makeId: (index: number) => string,
  /**
   * The period the statement itself prints, when the parser found it or the
   * user confirmed it. It is the bank saying "these are all the transactions
   * between these dates", so an Actual transaction in the last days of it that
   * the statement does not list is a real question — not padding to keep by
   * default, which is what it was when the period stopped at the last row.
   */
  printedPeriod?: { start: string | null; end: string | null } | null
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

  return { rows, errors, totals: totalsFor(rows), period: withPrintedPeriod(periodFor(rows), printedPeriod) };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The rows' own span widened to the printed period. Never narrowed: a row the
 * parser dated outside the printed period is still on the statement.
 */
export function withPrintedPeriod(
  rowsPeriod: { start: string; end: string } | null,
  printed: { start: string | null; end: string | null } | null | undefined
): { start: string; end: string } | null {
  if (!rowsPeriod) return null;
  // A printed period this far from the rows is a misread or a typo, and taking
  // it would load (and ask about) months of unrelated transactions.
  const near = (date: string, from: string) =>
    Math.abs(Date.parse(date) - Date.parse(from)) <= MAX_WIDENING_DAYS * 86_400_000;
  const start = printed?.start && ISO_DATE.test(printed.start) && printed.start < rowsPeriod.start &&
    near(printed.start, rowsPeriod.start) ? printed.start : rowsPeriod.start;
  const end = printed?.end && ISO_DATE.test(printed.end) && printed.end > rowsPeriod.end &&
    near(printed.end, rowsPeriod.end) ? printed.end : rowsPeriod.end;
  return { start, end };
}

const MAX_WIDENING_DAYS = 45;

/**
 * The balance a PDF statement closed at, in Actual's sign, or null when the
 * statement does not settle it.
 *
 * A printed closing-balance line wins. Without one, the running balance printed
 * on the chronologically last row is the same figure — nothing posted after it
 * — but only when the balance column is a running balance and that row's
 * balance agreed with its own arithmetic. Null when the parser could not tell a
 * deposit account from a liability (the sign would be a guess), or when the
 * figure carries more precision than Actual stores.
 */
export function closingBalanceFromPdf(
  result: Pick<PdfStatementParseResult, "balanceCheckpoints" | "balancePolarity" | "balanceBehavior" | "transactions">,
  asOf: string | null | undefined,
  /**
   * The statement's printed closing date. A closing-balance line is the
   * balance on that date, so without it (or when the period fell back to the
   * last row's date) the line is not used: Actual transactions between the
   * last row and the real closing date would be missed.
   */
  printedEnd?: string | null
): StatementClosingBalance | null {
  if (!asOf || !result.balancePolarity) return null;
  const polarity = result.balancePolarity.direction;
  const toActual = (minor: number) => (polarity === "liability" ? -minor : minor);
  const base = { asOf, polarity, polarityDetected: result.balancePolarity.source === "detected-type" } as const;

  const closing = [...(result.balanceCheckpoints ?? [])].reverse().find((checkpoint) => checkpoint.kind === "closing");
  if (closing && printedEnd && printedEnd === asOf) {
    const minor = minorUnitsOf(BigInt(closing.coefficient), closing.scale);
    return minor === null ? null : { ...base, amount: toActual(minor), source: "closing-line" };
  }

  if (result.balanceBehavior !== "running") return null;
  // The chronologically last row decides, balance or not: skipping a final row
  // without one would report an earlier row's balance as the closing figure.
  const dated = result.transactions.filter((transaction) => transaction.importDate);
  if (!dated.length) return null;
  // The latest date decides; printed order only breaks a tie between rows on
  // that date (first printed for a newest-first statement, else last printed).
  const latest = dated.reduce((max, transaction) => (transaction.importDate! > max ? transaction.importDate! : max), dated[0].importDate!);
  let ascending = 0;
  let descending = 0;
  dated.slice(1).forEach((transaction, index) => {
    if (transaction.importDate! > dated[index].importDate!) ascending += 1;
    if (transaction.importDate! < dated[index].importDate!) descending += 1;
  });
  const onLatest = dated.filter((transaction) => transaction.importDate === latest);
  const last = descending > ascending ? onLatest[0] : onLatest[onLatest.length - 1];
  if (!last.balance || !last.confidence.balance?.reasons.includes("BALANCE_RECONCILED")) return null;
  const minor = parsePdfMoneyToMinorUnits(last.balance!);
  return minor === null ? null : { ...base, amount: toActual(minor), source: "last-row" };
}

/** Exact coefficient/scale to integer hundredths, or null when that would lose a digit. */
function minorUnitsOf(coefficient: bigint, scale: number): number | null {
  let value = coefficient;
  if (scale < 2) value *= BigInt(10) ** BigInt(2 - scale);
  else if (scale > 2) {
    const divisor = BigInt(10) ** BigInt(scale - 2);
    if (value % divisor !== BigInt(0)) return null;
    value /= divisor;
  }
  const minor = Number(value);
  return Number.isSafeInteger(minor) ? minor : null;
}
