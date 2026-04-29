/**
 * Budget CSV serialization, parsing, and import matching.
 *
 * CSV format:
 *   Header: Group Name,Category Name,YYYY-MM,YYYY-MM,...
 *   Amounts: decimal strings (NOT minor units) — e.g. "150.00"
 *   Empty cells: no change during import (treated as no-op)
 */

import { minorToDecimalString, decimalStringToMinor } from "./format";
import type {
  BudgetCellKey,
  LoadedCategory,
  LoadedGroup,
  LoadedMonthState,
  StagedBudgetEdit,
} from "../types";

// ─── Import types (re-exported for convenience) ───────────────────────────────

export type BudgetCsvRow = {
  groupName: string;
  categoryName: string;
  monthValues: Record<string, string>; // month → decimal string
};

export type ImportMatchStatus = "exact" | "suggested" | "unmatched";

export type ImportMonthAvailability = "available" | "out-of-range" | "absent";

export type ImportRowResult = {
  csvRow: BudgetCsvRow;
  matchedCategoryId: string | null;
  matchedCategoryName: string | null;
  matchedGroupName: string | null;
  matchStatus: ImportMatchStatus;
  suggestionKey?: string;
  monthAvailability: Record<string, ImportMonthAvailability>;
};

export type ImportPreviewEntry = {
  categoryId: string;
  categoryName: string;
  groupName: string;
  month: string;
  previousBudgeted: number; // minor units
  nextBudgeted: number;     // minor units
};

export type BudgetExportOptions = {
  months: string[];
  includeHidden: boolean;
  includeIncome: boolean;
};

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Builds a CSV string from loaded budget data.
 *
 * monthDataMap must contain a LoadedMonthState for every month in the months
 * array — each cell reads its budgeted value from the correct month's data,
 * not from a single snapshot. Missing months produce 0.00.
 *
 * If stagedEdits is provided, cells with staged edits use the staged value
 * instead of the persisted value (staged-view export, FR-031).
 */
export function exportToCsv(
  months: string[],
  groups: LoadedGroup[],
  monthDataMap: Record<string, LoadedMonthState>,
  opts: BudgetExportOptions,
  stagedEdits?: Record<BudgetCellKey, StagedBudgetEdit>
): string {
  // Use any available month's categoriesById for schema-level lookups
  // (category names, hidden flags, IDs) — these don't vary per month.
  const refCategoriesById =
    Object.values(monthDataMap)[0]?.categoriesById ?? {};

  const header = ["Group Name", "Category Name", ...months]
    .map(csvEscape)
    .join(",");

  const rows: string[] = [header];

  for (const group of groups) {
    if (!opts.includeIncome && group.isIncome) continue;
    if (!opts.includeHidden && group.hidden) continue;

    for (const catId of group.categoryIds) {
      const cat = refCategoriesById[catId];
      if (!cat) continue;
      if (!opts.includeHidden && cat.hidden) continue;

      const cells: string[] = [csvEscape(group.name), csvEscape(cat.name)];

      for (const month of months) {
        const key: BudgetCellKey = `${month}:${cat.id}`;
        const staged = stagedEdits?.[key];
        const monthCat = monthDataMap[month]?.categoriesById[cat.id];
        const minorValue = staged != null ? staged.nextBudgeted : (monthCat?.budgeted ?? 0);
        cells.push(csvEscape(minorToDecimalString(minorValue)));
      }

      rows.push(cells.join(","));
    }
  }

  return rows.join("\n");
}

/**
 * Builds a blank CSV template (same structure as export, all amount cells empty).
 */
export function exportBlankTemplate(
  months: string[],
  groups: LoadedGroup[],
  categoriesById: Record<string, LoadedCategory>,
  opts: BudgetExportOptions
): string {
  const header = ["Group Name", "Category Name", ...months]
    .map(csvEscape)
    .join(",");

  const rows: string[] = [header];

  for (const group of groups) {
    if (!opts.includeIncome && group.isIncome) continue;
    if (!opts.includeHidden && group.hidden) continue;

    for (const catId of group.categoryIds) {
      const cat = categoriesById[catId];
      if (!cat) continue;
      if (!opts.includeHidden && cat.hidden) continue;

      const blanks = months.map(() => "");
      rows.push(
        [csvEscape(group.name), csvEscape(cat.name), ...blanks].join(",")
      );
    }
  }

  return rows.join("\n");
}

// ─── Import parsing ───────────────────────────────────────────────────────────

/**
 * Parses raw CSV text into BudgetCsvRows.
 * Expects first row to be a header with "Group Name", "Category Name",
 * followed by month column headers.
 */
export function parseCsv(raw: string): BudgetCsvRow[] {
  // Strip UTF-8 BOM that Excel and some tools prepend.
  const stripped = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const lines = stripped.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headerCells = parseCsvLine(lines[0] ?? "");
  const monthColumns = headerCells.slice(2);

  const rows: BudgetCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i] ?? "");
    const groupName = (cells[0] ?? "").trim();
    const categoryName = (cells[1] ?? "").trim();

    if (!groupName && !categoryName) continue;

    const monthValues: Record<string, string> = {};
    for (let j = 0; j < monthColumns.length; j++) {
      const month = monthColumns[j];
      const value = cells[j + 2];
      if (month && value !== undefined && value !== "") {
        monthValues[month.trim()] = value.trim();
      }
    }

    rows.push({ groupName, categoryName, monthValues });
  }

  return rows;
}

// ─── Import matching ──────────────────────────────────────────────────────────

/**
 * Matches parsed CSV rows to known categories.
 * Primary match: exact case-insensitive groupName:categoryName key.
 * Fallback: Levenshtein distance ≤ 2 (suggestion, requires user approval).
 * Month availability classified as: available | out-of-range | absent.
 */
export function matchImportRows(
  rows: BudgetCsvRow[],
  categories: LoadedCategory[],
  availableMonths: string[],
  visibleMonths: string[]
): ImportRowResult[] {
  const availableSet = new Set(availableMonths);
  const visibleSet = new Set(visibleMonths);

  // Build exact-match lookup: "group:category" → category
  const exactMap = new Map<string, LoadedCategory>();
  for (const cat of categories) {
    const key = makeMatchKey(cat.groupName, cat.name);
    exactMap.set(key, cat);
  }

  const allKeys = Array.from(exactMap.keys());

  return rows.map((row) => {
    const rowKey = makeMatchKey(row.groupName, row.categoryName);

    // Classify month availability for all months in this row
    const monthAvailability: Record<string, ImportMonthAvailability> = {};
    for (const month of Object.keys(row.monthValues)) {
      if (!availableSet.has(month)) {
        monthAvailability[month] = "absent";
      } else if (!visibleSet.has(month)) {
        monthAvailability[month] = "out-of-range";
      } else {
        monthAvailability[month] = "available";
      }
    }

    // Exact match
    const exactMatch = exactMap.get(rowKey);
    if (exactMatch) {
      return {
        csvRow: row,
        matchedCategoryId: exactMatch.id,
        matchedCategoryName: exactMatch.name,
        matchedGroupName: exactMatch.groupName,
        matchStatus: "exact" as const,
        monthAvailability,
      };
    }

    // Suggestion: find closest key by Levenshtein distance ≤ 2
    let bestKey: string | null = null;
    let bestDist = Infinity;
    for (const key of allKeys) {
      const dist = levenshtein(rowKey, key);
      if (dist < bestDist && dist <= 2) {
        bestDist = dist;
        bestKey = key;
      }
    }

    if (bestKey !== null) {
      const suggested = exactMap.get(bestKey)!;
      return {
        csvRow: row,
        matchedCategoryId: suggested.id,
        matchedCategoryName: suggested.name,
        matchedGroupName: suggested.groupName,
        matchStatus: "suggested" as const,
        suggestionKey: bestKey,
        monthAvailability,
      };
    }

    return {
      csvRow: row,
      matchedCategoryId: null,
      matchedCategoryName: null,
      matchedGroupName: null,
      matchStatus: "unmatched" as const,
      monthAvailability,
    };
  });
}

/**
 * Builds the final list of import preview entries from approved import rows.
 * Only rows with matchStatus "exact" or "suggested" (explicitly approved by user)
 * and with monthAvailability "available" produce preview entries.
 * "out-of-range" and "absent" months are excluded — handled separately by UI.
 */
export function buildImportPreview(
  approved: ImportRowResult[],
  groups: LoadedGroup[],
  categoriesById: Record<string, LoadedCategory>
): ImportPreviewEntry[] {
  const entries: ImportPreviewEntry[] = [];

  for (const result of approved) {
    if (!result.matchedCategoryId) continue;

    for (const [month, decimalStr] of Object.entries(result.csvRow.monthValues)) {
      const avail = result.monthAvailability[month];
      if (avail !== "available") continue;

      const nextBudgeted = decimalStringToMinor(decimalStr);
      if (isNaN(nextBudgeted)) continue;

      // Find the current persisted budgeted for this category from categoriesById.
      const cat = categoriesById[result.matchedCategoryId];
      const previousBudgeted = cat?.budgeted ?? 0;

      // Resolve groupName from the groups list (for display purposes).
      let groupName = result.matchedGroupName ?? "";
      if (!groupName) {
        for (const g of groups) {
          if (g.categoryIds.includes(result.matchedCategoryId)) {
            groupName = g.name;
            break;
          }
        }
      }

      entries.push({
        categoryId: result.matchedCategoryId,
        categoryName: result.matchedCategoryName ?? "",
        groupName,
        month,
        previousBudgeted,
        nextBudgeted,
      });
    }
  }

  return entries;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function makeMatchKey(groupName: string, categoryName: string): string {
  return `${groupName.trim().toLowerCase()}:${categoryName.trim().toLowerCase()}`;
}

/** Escapes a CSV cell value. Wraps in quotes if it contains comma, quote, or newline. */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Parses a single CSV line, handling quoted fields. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  cells.push(current);
  return cells;
}

/**
 * Levenshtein distance between two strings (case-insensitive match keys).
 * Returns early if distance exceeds threshold to avoid wasted work.
 */
function levenshtein(a: string, b: string, threshold = 3): number {
  if (Math.abs(a.length - b.length) > threshold) return threshold + 1;

  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]!;
      // Match case: dp[i][j] = dp[i-1][j-1] (held in `prev`).
      // Non-match: 1 + min(dp[i][j-1]=dp[j-1], dp[i-1][j]=temp, dp[i-1][j-1]=prev).
      dp[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(dp[j - 1]!, temp, prev);
      prev = temp;
    }
  }

  return dp[n]!;
}
