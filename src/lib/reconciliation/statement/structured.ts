/**
 * Structured statement formats → the canonical statement model (RD-072 §2.5).
 *
 * OFX/QFX and QIF state what CSV can only be guessed at: which text is the
 * bank's payee and which is its memo. This module is the single place that turns
 * that pair into `StatementRow.importedPayee` / `StatementRow.bankNotes`, so
 * every structured format shares one set of rules and nothing downstream — the
 * matcher, the planner, Apply — ever learns which format a row came from.
 *
 * The swap/fallback rules mirror Actual's own file importer, including the part
 * that is easy to miss: when a memo is *consumed* as the payee source, it does
 * not also become the note. Duplicating the same text into both fields merely
 * because the bank left `NAME` empty is noise, not provenance.
 */

import type { MinorUnitAmount, StatementRow } from "../types";
import {
  fingerprintRow,
  originalAmountFor,
  parseMoneyToMinorUnits,
  parseStatementDate,
  periodFor,
  totalsFor,
  type NormalizedStatement,
  type StatementParseConfig,
  type StatementRowError,
} from "./normalize";

/**
 * One transaction as a structured parser read it, before any interpretation.
 *
 * Values stay as strings so the normalizer owns every conversion — and so the
 * fingerprint can be taken over exactly what the file said, independently of
 * the parse options the user may still change.
 */
export type StructuredStatementTransaction = {
  /** 1-based position in the file, for "transaction 42 could not be read". */
  sourceRowNumber: number;
  /** ISO for OFX (its dates are unambiguous); bank-formatted for QIF. */
  date: string | null;
  amount: string | null;
  /** OFX `NAME`, QIF `P`. */
  payeeText: string | null;
  /** OFX `MEMO`, QIF `M`. */
  memoText: string | null;
  /** OFX `FITID` — a bank transaction id, matching evidence only. */
  externalId?: string | null;
  /** OFX `CHECKNUM`/`REFNUM`, QIF `N`. */
  reference?: string | null;
  /** OFX `TRNTYPE`. Carried for display; not an Actual transaction field. */
  type?: string | null;
  /** Everything the parser saw for this transaction. Never overwritten. */
  raw: Record<string, string>;
};

/** Which two texts a row's channels actually came from, after swap/fallback. */
export function resolveTextChannels(
  transaction: Pick<StructuredStatementTransaction, "payeeText" | "memoText">,
  config: Pick<StatementParseConfig, "swapPayeeAndMemo" | "fallbackPayeeToMemo">
): { importedPayee: string; bankNotes?: string } {
  const payeeSource = (config.swapPayeeAndMemo ? transaction.memoText : transaction.payeeText)?.trim() || "";
  const memoSource = (config.swapPayeeAndMemo ? transaction.payeeText : transaction.memoText)?.trim() || "";

  // The memo stands in for a missing payee only when asked to — and having done
  // so, it is no longer available as a note.
  const memoConsumed = !payeeSource && config.fallbackPayeeToMemo && memoSource !== "";

  return {
    importedPayee: payeeSource || (memoConsumed ? memoSource : ""),
    bankNotes: memoConsumed ? undefined : memoSource || undefined,
  };
}

export function normalizeStructuredStatement(
  transactions: StructuredStatementTransaction[],
  config: StatementParseConfig,
  makeId: (index: number) => string
): NormalizedStatement {
  const rows: StatementRow[] = [];
  const errors: StatementRowError[] = [];

  // OFX dates are already ISO and its amounts are always dot-decimal; QIF
  // inherits the user's conventions, because Quicken exports follow the locale
  // that produced them.
  const dateFormat = config.format === "ofx" ? "iso" : config.dateFormat;
  const decimalSeparator = config.format === "ofx" ? "." : config.decimalSeparator;

  transactions.forEach((transaction, index) => {
    const sourceRowNumber = transaction.sourceRowNumber;
    const cells = rawCells(transaction);

    const postedDate = parseStatementDate(transaction.date ?? "", dateFormat);
    if (!postedDate) {
      errors.push({
        sourceRowNumber,
        cells,
        reason: "unparseable-date",
        detail: transaction.date
          ? `Could not read "${transaction.date}" as a ${dateFormat} date`
          : "This transaction has no date",
      });
      return;
    }

    const amount: MinorUnitAmount | null = parseMoneyToMinorUnits(
      transaction.amount ?? "",
      decimalSeparator,
      config.minorUnitDigits
    );
    if (amount === null) {
      errors.push({
        sourceRowNumber,
        cells,
        reason: "unparseable-amount",
        detail: transaction.amount
          ? `Could not read "${transaction.amount}" as an amount`
          : "This transaction has no amount",
      });
      return;
    }

    const { importedPayee, bankNotes } = resolveTextChannels(transaction, config);

    rows.push({
      id: makeId(index),
      sourceRowNumber,
      postedDate,
      amount,
      importedPayee,
      bankNotes,
      bankReference: transaction.reference?.trim() || undefined,
      externalId: transaction.externalId?.trim() || undefined,
      ...originalAmountFor([importedPayee, bankNotes], amount, config),
      raw: transaction.raw,
      // Over what the file said, never over what the options made of it: a user
      // toggling "swap payee and memo" must not change a row's identity, or a
      // retry after a partial apply would create the transaction a second time.
      fingerprint: fingerprintRow(cells, sourceRowNumber),
    });
  });

  return { rows, errors, totals: totalsFor(rows), period: periodFor(rows) };
}

function rawCells(transaction: StructuredStatementTransaction): string[] {
  return [
    transaction.date ?? "",
    transaction.amount ?? "",
    transaction.payeeText ?? "",
    transaction.memoText ?? "",
    transaction.externalId ?? "",
    transaction.reference ?? "",
  ];
}
