/**
 * Nothing matched — and flipping the statement's signs would have matched.
 *
 * Some banks publish a single amount column with spend as a *positive* number,
 * leaving the direction to a heading elsewhere on the page. Actual always
 * stores spend as negative, and matching requires an exact **signed** amount,
 * so such a statement matches nothing at all: every row falls through to "Not
 * in Actual" and every transaction to "Actual only". The account looks empty,
 * or the period wrong, or the statement unrelated — the one thing it does not
 * look like is a sign convention.
 *
 * ## Why this is decided here and not at import
 *
 * The import screen sees only the statement, so all it could ever observe is
 * "every amount is positive" — which a credit-card month with no refunds also
 * satisfies. That is a guess, and a caution nobody can act on confidently is
 * noise.
 *
 * By the time the workbench exists both sides are in hand, so the question can
 * be *tested* instead of inferred: negate the rows and see whether they find
 * counterparts. That is why this reads a built session rather than a parse
 * result, and why it says "47 rows would match" rather than "amounts look
 * unusual".
 *
 * ## Why exact amounts and a date window
 *
 * The same evidence real matching uses, minus the sign. Text is deliberately
 * ignored: the statement text of a bank that inverts its signs is usually the
 * least recognisable part of it, and the claim being made here is narrow —
 * *these amounts line up when flipped* — not *these are the same merchant*.
 *
 * Pairing is one-to-one. A statement with four identical 25.00 charges should
 * count four transactions, not the same one four times.
 *
 * Within an amount bucket every transaction carries the same figure, so the
 * only constraint left is the date window - which makes each row's eligible set
 * a contiguous range of dates, and the graph convex. Walking both sides in date
 * order and taking the earliest transaction still in range is optimal on a
 * convex bipartite graph, where a first-fit over unsorted lists is not: two rows
 * a fortnight apart can both reach one middle-dated transaction, and letting the
 * later row take it strands the earlier one against a partner it could have had.
 */

import { dayDelta } from "../match/score";
import type { ActualTransactionSnapshot, StatementRow } from "../types";

export type InvertedSignDiagnosis = {
  /** Statement rows that would find an exact signed counterpart when flipped. */
  wouldMatch: number;
  /** Rows considered, so the message can say "47 of 52". */
  statementRows: number;
};

/**
 * How far apart a row and its flipped counterpart may post.
 *
 * Wider than the matcher's own tolerance on purpose. This is not proposing a
 * match, it is explaining a total failure, and a session configured with zero
 * date tolerance is exactly the one whose evidence would otherwise be invisible.
 */
const DAY_WINDOW = 7;

/**
 * Below this the evidence is coincidence, not a convention.
 *
 * Two conditions rather than one: a share, so a long statement with a handful
 * of accidental hits stays quiet, and a floor, so a three-row statement that
 * flips cleanly still speaks.
 */
const MIN_ROWS = 2;
const MIN_SHARE = 0.2;

export function diagnoseInvertedSigns(input: {
  statementRows: StatementRow[];
  transactions: ActualTransactionSnapshot[];
  /**
   * Statement rows the matcher accounted for. Anything above zero means the
   * sign convention is right and some *other* thing went wrong, which this has
   * nothing useful to say about.
   */
  matched: number;
}): InvertedSignDiagnosis | null {
  const { statementRows, transactions, matched } = input;
  if (matched > 0) return null;
  if (statementRows.length === 0 || transactions.length === 0) return null;

  // Grouped by amount so a long statement does not rescan every transaction per
  // row; each bucket is date-ordered so the walk below can take the earliest
  // partner still in range.
  const byAmount = new Map<number, ActualTransactionSnapshot[]>();
  for (const transaction of transactions) {
    const bucket = byAmount.get(transaction.amount);
    if (bucket) bucket.push(transaction);
    else byAmount.set(transaction.amount, [transaction]);
  }
  for (const bucket of byAmount.values()) {
    bucket.sort((a, b) => a.date.localeCompare(b.date));
  }

  const claimed = new Set<string>();
  let wouldMatch = 0;

  // Rows in date order too: taking the earliest available partner is only
  // optimal if the rows asking for one arrive in the same order.
  const inDateOrder = [...statementRows].sort((a, b) =>
    a.postedDate.localeCompare(b.postedDate)
  );

  for (const row of inDateOrder) {
    const bucket = byAmount.get(-row.amount);
    if (!bucket) continue;

    const counterpart = bucket.find(
      (transaction) =>
        !claimed.has(transaction.id) &&
        Math.abs(dayDelta(row.postedDate, transaction.date)) <= DAY_WINDOW
    );
    if (!counterpart) continue;

    claimed.add(counterpart.id);
    wouldMatch += 1;
  }

  if (wouldMatch < MIN_ROWS) return null;
  if (wouldMatch < statementRows.length * MIN_SHARE) return null;

  return { wouldMatch, statementRows: statementRows.length };
}

/**
 * Statement rows with their signs flipped, ready to re-run.
 *
 * Kept beside the diagnosis because they are two halves of one claim, and a
 * negation applied somewhere else would be a second place for the rule to drift.
 * Only `amount` changes — the bank's own text, dates and references are what
 * they always were.
 */
export function invertStatementRows(rows: StatementRow[]): StatementRow[] {
  return rows.map((row) => ({ ...row, amount: -row.amount }));
}
