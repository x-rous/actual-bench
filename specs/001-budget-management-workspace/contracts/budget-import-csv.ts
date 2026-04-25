/**
 * Budget CSV Import/Export — Schema and row-matching contracts
 *
 * CSV format consumed by the import dialog and produced by the export action.
 * Column order is fixed; the month columns are dynamic based on the selected range.
 */

// ---------------------------------------------------------------------------
// CSV file structure
// ---------------------------------------------------------------------------

/**
 * Header row format (example for months 2025-01 through 2025-03):
 *
 *   Group Name,Category Name,2025-01,2025-02,2025-03
 *
 * - "Group Name" and "Category Name" are the first two columns, always present.
 * - Each subsequent column header is an ISO month string "YYYY-MM".
 * - Amount cells contain decimal values (NOT minor units) — e.g. "150.00".
 * - Empty cells mean "no change" during import (not zero).
 */
export type BudgetCsvRow = {
  /** Trimmed, case-insensitive group name for matching */
  groupName: string;
  /** Trimmed, case-insensitive category name for matching */
  categoryName: string;
  /** Month → decimal string value map; missing months are treated as no-op */
  monthValues: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Import matching result
// ---------------------------------------------------------------------------

export type ImportMatchStatus =
  | "exact" // groupName+categoryName matched exactly (case-insensitive)
  | "suggested" // Levenshtein distance ≤ 2 from an exact key; user must approve
  | "unmatched"; // no match found; row is excluded from staging

export type ImportRowResult = {
  csvRow: BudgetCsvRow;
  /** Null when status is "unmatched" */
  matchedCategoryId: string | null;
  matchedCategoryName: string | null;
  matchedGroupName: string | null;
  matchStatus: ImportMatchStatus;
  /** Populated when matchStatus is "suggested" */
  suggestionKey?: string;
  /** Null when month does not exist in GET /months */
  monthAvailability: Record<
    string,
    | "available" // in GET /months and in visible range
    | "out-of-range" // in GET /months but outside visible range
    | "absent" // not in GET /months at all
  >;
};

// ---------------------------------------------------------------------------
// Import preview entry (one per (category, month) pair to be staged)
// ---------------------------------------------------------------------------

export type ImportPreviewEntry = {
  categoryId: string;
  categoryName: string;
  groupName: string;
  month: string;
  /** Current persisted value, minor units */
  previousBudgeted: number;
  /** Proposed import value, minor units */
  nextBudgeted: number;
};

// ---------------------------------------------------------------------------
// Export options
// ---------------------------------------------------------------------------

export type BudgetExportOptions = {
  /** Months to include; must all exist in GET /months */
  months: string[];
  /** Whether to include hidden categories */
  includeHidden: boolean;
  /** Whether to include income category groups */
  includeIncome: boolean;
};
