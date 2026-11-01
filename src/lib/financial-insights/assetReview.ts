import { BOOK_TYPES } from "@/lib/asset-registry/models";
import { typeFromNotes } from "@/lib/asset-registry/tags";
import type { ReclassifiedRow } from "./measures";
import type { ResolvedPeriod } from "./period";

/**
 * What the Asset Registry says about the rows of the asset accounts registered in it. Only its own classifications are
 * used, never a guess from an amount, a date or a name:
 *  - a row classified as a value change (revaluation, depreciation, impairment, other adjustment, disposal or opening
 *    balance) is not income or spending: it goes to its own line;
 *  - a row classified as capital put in (acquisition or added capital) without a recorded transfer might be the other half
 *    of an expense recorded elsewhere, so it needs review;
 *  - every other row, including one nobody classified, is an ordinary movement: its category decides what it is, and a
 *    movement with no category is read like any other uncategorized one.
 * Rows of accounts that are not registered are never read.
 */

/** Book types that are a change in an asset's worth, not money put into it. */
const VALUE_CHANGE_TYPES: ReadonlySet<string> = new Set(["revaluation", "depreciation", "impairment", "other-adjustment", "disposal", "opening-balance"]);
/** Book types that put money or cost into the asset. */
const CAPITAL_TYPES: ReadonlySet<string> = new Set(["acquisition", "added-capital"]);

/** Above this many rows in a registered account, they are not read; only the measures that need them are affected. */
export const ASSET_ROW_LIMIT = 5000;

export type AssetEntry = { id: string; date: string; accountId: string; categoryId: string | null; amountMinor: number; notes: string | null };

export type SavedClassification = { actualTransactionId: string; actualAccountId: string; classification: string | null };

export type ReviewEntry = AssetEntry & { reason: string };

/** A saved classification, or the type tagged in Notes; a suggestion is not a classification. */
export function classificationOf(entry: AssetEntry, saved: ReadonlyMap<string, SavedClassification>): string | null {
  const known = saved.get(entry.id);
  const savedType = known && known.actualAccountId === entry.accountId && known.classification && Object.hasOwn(BOOK_TYPES, known.classification) ? known.classification : null;
  return savedType ?? typeFromNotes(entry.notes);
}

/** The rows the registry classifies as a value change, whatever their date. */
export function valueChangeRows(entries: readonly AssetEntry[], saved: readonly SavedClassification[]): ReclassifiedRow[] {
  const byId = new Map(saved.map((s) => [s.actualTransactionId, s]));
  return entries.flatMap((entry) => {
    const type = classificationOf(entry, byId);
    return type && VALUE_CHANGE_TYPES.has(type)
      ? [{ month: entry.date.slice(0, 7), accountId: entry.accountId, categoryId: entry.categoryId, amountMinor: entry.amountMinor, to: "valueChange" as const }]
      : [];
  });
}

/** The capital rows in the period: classified as put into an asset, with no transfer recorded behind them. */
export function reviewAssetEntries(entries: readonly AssetEntry[], saved: readonly SavedClassification[], period: ResolvedPeriod): ReviewEntry[] {
  const byId = new Map(saved.map((s) => [s.actualTransactionId, s]));
  const review: ReviewEntry[] = [];
  for (const entry of entries) {
    if (entry.date < period.startDate || entry.date > period.endDate) continue;
    const type = classificationOf(entry, byId);
    if (type && CAPITAL_TYPES.has(type)) review.push({ ...entry, reason: `Classified as ${BOOK_TYPES[type as keyof typeof BOOK_TYPES]}, but not paid by a recorded transfer` });
  }
  return review.sort((a, b) => a.date.localeCompare(b.date));
}
