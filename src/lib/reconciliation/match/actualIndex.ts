/**
 * The Actual-side index that makes matching fast (RD-071 §5.3).
 *
 * Named `actualIndex.ts` rather than `index.ts` so it can never be mistaken for
 * a directory barrel.
 *
 * The governing decision: automatic matches require an **exact signed amount**
 * (RD-071 D9). That makes amount a perfect blocking key — candidates are found
 * by hash lookup, never by scanning — so text similarity is only ever used to
 * *rank* candidates, never to find them. The safety rule and the performance
 * property are the same rule.
 *
 * Within an amount bucket rows are kept sorted by date, so the ±tolerance
 * window is a binary-searched slice. That is what bounds the pathological case:
 * a year of identical subscription charges is a large bucket, but its ±7-day
 * slice is a couple of rows.
 */

import type { ActualTransactionSnapshot, MinorUnitAmount } from "../types";
import { buildTextCorpus, type TextCorpus } from "./text";

export type ActualIndex = {
  /** Every indexed row, by id. */
  byId: Map<string, ActualTransactionSnapshot>;
  /**
   * Every indexed row ordered by date, for the amount-mismatch review scan.
   *
   * That scan cannot use the amount as a blocking key — the amounts are what
   * disagree — so it walks a date slice instead. It only runs for statement
   * rows that found no exact-amount match, and the slice is a couple of weeks
   * wide, so the cost stays bounded.
   */
  byDate: ActualTransactionSnapshot[];
  /** Actual `imported_id` -> row id, for the strongest tier. */
  byImportedId: Map<string, string>;
  /** Exact signed minor-unit amount -> rows, ascending by date. */
  byAmount: Map<MinorUnitAmount, ActualTransactionSnapshot[]>;
  /** Token frequencies across the candidate window, for the needle floor. */
  notesCorpus: TextCorpus;
};

/**
 * Build the index over the loaded candidate window. O(m log m).
 *
 * Split **children** are excluded: the statement's financial counterpart is the
 * split *parent*, which carries the posted amount (RD-071 D12). Children remain
 * reachable through `parent.splitLines` for display.
 */
export function buildActualIndex(
  transactions: ActualTransactionSnapshot[]
): ActualIndex {
  const byId = new Map<string, ActualTransactionSnapshot>();
  const byImportedId = new Map<string, string>();
  const byAmount = new Map<MinorUnitAmount, ActualTransactionSnapshot[]>();

  for (const transaction of transactions) {
    if (transaction.isChild) continue;
    byId.set(transaction.id, transaction);

    if (transaction.importedId) {
      // First writer wins: a duplicated imported_id is itself a data problem,
      // and the loser surfaces through normal duplicate detection rather than
      // silently replacing the winner here.
      if (!byImportedId.has(transaction.importedId)) {
        byImportedId.set(transaction.importedId, transaction.id);
      }
    }

    const bucket = byAmount.get(transaction.amount);
    if (bucket) bucket.push(transaction);
    else byAmount.set(transaction.amount, [transaction]);
  }

  for (const bucket of byAmount.values()) {
    // ISO `YYYY-MM-DD` sorts lexicographically in chronological order. Ties are
    // broken by id so the index — and therefore the whole match graph — is
    // deterministic for identical inputs.
    bucket.sort((a, b) => (a.date === b.date ? compareIds(a.id, b.id) : a.date < b.date ? -1 : 1));
  }

  const byDate = [...byId.values()].sort((a, b) =>
    a.date === b.date ? compareIds(a.id, b.id) : a.date < b.date ? -1 : 1
  );

  return {
    byId,
    byImportedId,
    byAmount,
    byDate,
    notesCorpus: buildTextCorpus([...byId.values()].map((t) => t.notes)),
  };
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Rows with exactly this amount whose date falls within `[minDate, maxDate]`.
 *
 * One hash lookup plus a binary search; the returned slice is typically 0-3
 * rows even for large accounts.
 */
export function amountDateSlice(
  index: ActualIndex,
  amount: MinorUnitAmount,
  minDate: string,
  maxDate: string
): ActualTransactionSnapshot[] {
  const bucket = index.byAmount.get(amount);
  if (!bucket || bucket.length === 0) return [];

  const start = lowerBound(bucket, minDate);
  const slice: ActualTransactionSnapshot[] = [];
  for (let i = start; i < bucket.length && bucket[i].date <= maxDate; i++) {
    slice.push(bucket[i]);
  }
  return slice;
}

/** Rows dated within `[minDate, maxDate]`, whatever their amount. */
export function dateSlice(
  index: ActualIndex,
  minDate: string,
  maxDate: string
): ActualTransactionSnapshot[] {
  const rows = index.byDate;
  const slice: ActualTransactionSnapshot[] = [];
  for (let i = lowerBound(rows, minDate); i < rows.length && rows[i].date <= maxDate; i++) {
    slice.push(rows[i]);
  }
  return slice;
}

/** Index of the first row whose date is >= `date`. */
function lowerBound(bucket: ActualTransactionSnapshot[], date: string): number {
  let low = 0;
  let high = bucket.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (bucket[mid].date < date) low = mid + 1;
    else high = mid;
  }
  return low;
}
