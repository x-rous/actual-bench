/**
 * Shared wording for what a bulk action actually did.
 *
 * Both the dialog and the immediate context-menu actions have to report the
 * same three things — written, skipped, and (for averages) how much history
 * the number really covered. Keeping the phrasing in one place is the point:
 * a skipped cell that is described one way in a toast and another way in a
 * preview is a cell the user has to reason about twice.
 */

import type { BulkPreviewResult } from "../hooks/useBulkAction";

export type BulkSkips = {
  missingSourceMonth: number;
  missingCategory: number;
  readOnly: number;
  /**
   * Months that exist in the budget file but whose fetch rejected. Separate
   * from `missingSourceMonth`: "the budget has no such month" is a fact about
   * the data, "it did not load" is a fault worth retrying, and reporting the
   * second as the first sends the user looking for the wrong thing.
   */
  failedToLoad?: string[];
};

export const NO_SKIPS: BulkSkips = {
  missingSourceMonth: 0,
  missingCategory: 0,
  readOnly: 0,
};

export function totalSkips(s: BulkSkips): number {
  return s.missingSourceMonth + s.missingCategory + s.readOnly;
}

/** True when any month the action needed failed to load rather than being absent. */
export function hasLoadFailures(s: BulkSkips): boolean {
  return (s.failedToLoad?.length ?? 0) > 0;
}

/**
 * Splits a preview result into the rows that may actually be written and a
 * skip tally that includes the read-only months the caller has to drop.
 */
export function collectSkips(
  result: BulkPreviewResult,
  readOnlyMonths: Set<string> | undefined
): { rows: BulkPreviewResult["rows"]; skips: BulkSkips } {
  const rows = result.rows.filter((row) => !readOnlyMonths?.has(row.month));
  return {
    rows,
    skips: {
      missingSourceMonth: result.skipped["missing-source-month"],
      missingCategory: result.skipped["missing-category"],
      readOnly: result.rows.length - rows.length,
    },
  };
}

/** "6 skipped — 4 with no source data, 2 in read-only months" */
export function describeSkips(s: BulkSkips): string {
  const parts: string[] = [];
  if (s.missingSourceMonth > 0) parts.push(`${s.missingSourceMonth} with no source data`);
  if (s.missingCategory > 0) parts.push(`${s.missingCategory} absent from the source month`);
  if (s.readOnly > 0) parts.push(`${s.readOnly} in read-only months`);
  const base = `${totalSkips(s)} skipped - ${parts.join(", ")}`;
  const failed = s.failedToLoad ?? [];
  if (failed.length === 0) return base;
  return `${base} (${failed.length} month${failed.length !== 1 ? "s" : ""} could not be loaded: ${failed.join(", ")})`;
}

/**
 * The short-average note, or null when the average covered everything asked
 * for. An average over fewer months than requested is a legitimate answer —
 * presenting it as a full one is not.
 */
export function describeAverageWindow(
  averageWindow: BulkPreviewResult["averageWindow"]
): string | null {
  if (!averageWindow) return null;
  const { requested, resolved } = averageWindow;
  if (resolved >= requested) return null;
  return `Averaged ${resolved} of ${requested} months - the rest have no budget data.`;
}
