/**
 * Budget CSV serialization, parsing, and import matching.
 *
 * CSV format:
 *   Header: Group Name,Category Name,YYYY-MM,YYYY-MM,...
 *   Amounts: decimal strings (NOT minor units) — e.g. "150.00"
 *   Empty cells: no change during import (treated as no-op)
 *
 * Import also reads what a spreadsheet makes of that file: comma, semicolon
 * or tab separated; month headers such as "Jan-26", "Jan 2026", "1/1/2026" or
 * "2026-01-01"; amounts such as "$1,234.50", "(150.00)" or "150,00".
 */

import { minorToDecimalString } from "./format";
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

/** Which figure an export writes for each category and month. */
export type BudgetExportValue = "budgeted" | "actuals" | "balance";

export type CsvDelimiter = "," | ";" | "\t";

export type BudgetExportOptions = {
  months: string[];
  includeHidden: boolean;
  includeIncome: boolean;
  /** Default "budgeted". Only budgeted exports can be imported back. */
  value?: BudgetExportValue;
  /** Default ",". A tab gives text that pastes into spreadsheet cells. */
  delimiter?: CsvDelimiter;
};

// ─── Export ───────────────────────────────────────────────────────────────────

/** The header marker of a non-budget export (see `exportToCsv`). */
const ANALYSIS_HEADER_LABEL: Record<Exclude<BudgetExportValue, "budgeted">, string> = {
  actuals: "Spent",
  balance: "Balance",
};

/**
 * A name a spreadsheet would read as a formula (=, +, -, @, tab or carriage
 * return first) is written with a leading apostrophe, which spreadsheets show
 * as text. `readLiteralText` removes it again on import.
 */
function literalText(name: string): string {
  return /^[=+\-@\t\r]/.test(name) ? `'${name}` : name;
}

function readLiteralText(cell: string): string {
  return /^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell;
}

/**
 * Builds a CSV string from loaded budget data.
 *
 * monthDataMap must contain a LoadedMonthState for every month in the months
 * array — each cell reads its value from the correct month's data, not from a
 * single snapshot. Missing months produce 0.00.
 *
 * Rows come from every exported month, not only the first: a category created
 * part-way through the range is still exported (0.00 before it existed), in
 * the group order of `groups` followed by any group that appears only later.
 *
 * If stagedEdits is provided, budgeted cells with staged edits use the staged
 * value instead of the persisted value (staged-view export, FR-031).
 */
export function exportToCsv(
  months: string[],
  groups: LoadedGroup[],
  monthDataMap: Record<string, LoadedMonthState>,
  opts: BudgetExportOptions,
  stagedEdits?: Record<BudgetCellKey, StagedBudgetEdit>
): string {
  const delimiter = opts.delimiter ?? ",";
  const value = opts.value ?? "budgeted";
  const escape = (cell: string) => escapeCell(cell, delimiter);
  const states = months
    .map((m) => monthDataMap[m])
    .filter((st): st is LoadedMonthState => st != null);

  // Union of rows across the exported months, in display order.
  const orderedGroups: LoadedGroup[] = [];
  const seenGroups = new Set<string>();
  const catIdsByGroup = new Map<string, string[]>();
  const categoriesById: Record<string, LoadedCategory> = {};
  const addGroup = (group: LoadedGroup, categoryIds: string[]) => {
    if (!seenGroups.has(group.id)) {
      seenGroups.add(group.id);
      orderedGroups.push(group);
      catIdsByGroup.set(group.id, []);
    }
    const list = catIdsByGroup.get(group.id)!;
    for (const id of categoryIds) if (!list.includes(id)) list.push(id);
  };
  for (const group of groups) addGroup(group, group.categoryIds);
  for (const st of states) {
    for (const groupId of st.groupOrder) {
      const group = st.groupsById[groupId];
      if (group) addGroup(group, group.categoryIds);
    }
    for (const [id, cat] of Object.entries(st.categoriesById)) {
      if (!categoriesById[id]) categoriesById[id] = cat;
    }
  }

  // Spent and balance exports say so in the header, so the importer can refuse
  // them instead of staging those figures as budgets.
  const categoryHeader =
    value === "budgeted" ? "Category Name" : `Category Name (${ANALYSIS_HEADER_LABEL[value]})`;
  const header = ["Group Name", categoryHeader, ...months].map(escape).join(delimiter);
  const rows: string[] = [header];

  for (const group of orderedGroups) {
    if (!opts.includeIncome && group.isIncome) continue;
    if (!opts.includeHidden && group.hidden) continue;

    for (const catId of catIdsByGroup.get(group.id) ?? []) {
      const cat = categoriesById[catId];
      if (!cat) continue;
      if (!opts.includeHidden && cat.hidden) continue;

      const cells: string[] = [escape(literalText(group.name)), escape(literalText(cat.name))];
      for (const month of months) {
        const monthCat = monthDataMap[month]?.categoriesById[cat.id];
        let minorValue: number;
        if (value === "budgeted") {
          const staged = stagedEdits?.[`${month}:${cat.id}` as BudgetCellKey];
          minorValue = staged != null ? staged.nextBudgeted : (monthCat?.budgeted ?? 0);
        } else {
          minorValue = monthCat?.[value] ?? 0;
        }
        cells.push(escape(minorToDecimalString(minorValue)));
      }
      rows.push(cells.join(delimiter));
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
  const delimiter = opts.delimiter ?? ",";
  const escape = (cell: string) => escapeCell(cell, delimiter);
  const header = ["Group Name", "Category Name", ...months]
    .map(escape)
    .join(delimiter);

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
        [escape(literalText(group.name)), escape(literalText(cat.name)), ...blanks].join(delimiter)
      );
    }
  }

  return rows.join("\n");
}

// ─── Import parsing ───────────────────────────────────────────────────────────

/** A cell in a month column that could not be read as an amount. */
export type InvalidImportCell = {
  /** 1-based line in the file. */
  line: number;
  groupName: string;
  categoryName: string;
  /** The column header as written in the file. */
  header: string;
  value: string;
};

export type ParsedBudgetCsv = {
  /** monthValues are keyed by YYYY-MM and hold only cells that read as amounts. */
  rows: BudgetCsvRow[];
  delimiter: CsvDelimiter;
  /** Month columns found, as written and as read. */
  monthColumns: { header: string; month: string }[];
  /** Columns after the first two whose header is not a month (ignored). */
  ignoredColumns: string[];
  /** Non-empty month cells that are not amounts (ignored, never staged). */
  invalidCells: InvalidImportCell[];
  /** Columns whose headers read as the same month (the import is refused). */
  duplicateMonthColumns: { month: string; headers: string[] }[];
  /**
   * Set when the file is a Spent or Balance export (its header says so):
   * those figures are not budgets and must not be imported.
   */
  analysisExport: string | null;
};

const MONTH_NAMES = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function toMonthKey(year: number, month: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12 || year < 1900 || year > 2199) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function fullYear(text: string): number {
  const year = Number(text);
  return text.length === 2 ? 2000 + year : year;
}

/** Strips spreadsheet text wrappers: `="2026-01"` and surrounding quotes. */
function unwrapSpreadsheetText(text: string): string {
  let t = text.trim();
  if (t.startsWith("=")) t = t.slice(1).trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  if (t.startsWith("'")) t = t.slice(1);
  return t.trim();
}

/**
 * Reads a month column header as YYYY-MM, or null.
 *
 * Accepts the export's own "2026-01" plus what spreadsheets turn it into:
 * "2026-01-01", "2026/01", "01/2026", "Jan-26", "Jan 2026", "January 2026",
 * "2026 Jan", and a first-of-month date such as "1/1/2026" or "01.03.2026".
 * In a d/m/y or m/d/y date the part that is 1 is taken as the day (every
 * month header is the first of its month); "1/1" is January.
 */
export function parseMonthHeader(raw: string): string | null {
  const text = unwrapSpreadsheetText(raw);
  if (!text) return null;
  let m: RegExpMatchArray | null;

  // 2026-01, 2026-1, 2026-01-01, 2026/01, 2026.01
  if ((m = text.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?:[ T].*)?$/))) {
    return toMonthKey(Number(m[1]), Number(m[2]));
  }
  // 01/2026, 1-2026
  if ((m = text.match(/^(\d{1,2})[-/.](\d{4})$/))) {
    return toMonthKey(Number(m[2]), Number(m[1]));
  }
  // 1/1/2026, 01.03.2026, 3/1/26
  if ((m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T].*)?$/))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = fullYear(m[3]!);
    if (a === 1 && b === 1) return toMonthKey(year, 1);
    if (a === 1) return toMonthKey(year, b); // day first: 1/3 = 1 March
    if (b === 1) return toMonthKey(year, a); // month first: 3/1 = March 1
    return null;
  }
  // Jan-26, Jan 2026, January 2026, Jan'26, 2026 Jan
  const named =
    text.match(/^([A-Za-z]{3,})\.?[\s\-/']*(\d{2}|\d{4})$/) ??
    (() => {
      const r = text.match(/^(\d{4})[\s\-/]+([A-Za-z]{3,})\.?$/);
      return r ? [r[0], r[2], r[1]] : null;
    })();
  if (named) {
    const name = named[1]!.toLowerCase();
    const index = MONTH_NAMES.findIndex((n) => name.startsWith(n));
    const fullNames = [
      "january", "february", "march", "april", "may", "june", "july",
      "august", "september", "october", "november", "december",
    ];
    if (index === -1 || !fullNames[index]!.startsWith(name)) {
      // "Sept" is common; anything else must be a prefix of the full name.
      if (!(index === 8 && name === "sept")) return null;
    }
    return toMonthKey(fullYear(named[2]!), index + 1);
  }
  return null;
}

/**
 * Reads an amount cell as integer minor units, or null when it is not one.
 *
 * Accepts "150", "150.00", "-150", "+150", "1,234.50", "1.234,50", "150,00",
 * "1 234,50", "$150", "€150", "USD 150", "(150.00)" and "150-" (both
 * negative). A single comma followed by one or two digits is a decimal comma;
 * otherwise commas group thousands. Where both separators appear, the last
 * one is the decimal point.
 */
export function parseImportAmount(raw: string): number | null {
  let text = unwrapSpreadsheetText(raw).replace(/[\s\u00a0\u202f]/g, "");
  if (!text) return null;

  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1);
  }
  // Currency symbols or a three-letter code on either side, around a sign.
  text = text.replace(/^[A-Za-z]{3}(?=[-+\d.,$€£¥₹])/, "").replace(/(?<=[\d.,])[A-Za-z]{3}$/, "");
  text = text.replace(/[$€£¥₹]/g, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  } else if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized: string;
  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? "," : ".";
    const group = decimal === "," ? "." : ",";
    // The whole part must be grouped in threes: 1,234.50 or 1.234,50.
    const whole = text.slice(0, text.lastIndexOf(decimal));
    const grouped = new RegExp(`^\\d{1,3}(?:\\${group}\\d{3})+$`);
    if (!grouped.test(whole)) return null;
    normalized = text.split(group).join("");
    if (normalized.split(decimal).length > 2) return null;
    normalized = normalized.replace(decimal, ".");
  } else if (lastComma !== -1) {
    const parts = text.split(",");
    if (parts.length === 2 && /^\d{1,2}$/.test(parts[1]!)) normalized = parts.join(".");
    else if (/^\d{1,3}(?:,\d{3})+$/.test(text)) normalized = parts.join("");
    else return null; // 1,2,3 or 12,3456: not a grouping anyone writes
  } else if (lastDot !== -1 && text.split(".").length > 2) {
    if (!/^\d{1,3}(?:\.\d{3})+$/.test(text)) return null;
    normalized = text.split(".").join(""); // 1.234.567
  } else {
    normalized = text;
  }
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const minor = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

/** Picks the separator the header line uses most: tab, semicolon or comma. */
function detectDelimiter(headerLine: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { "\t": 0, ";": 0, ",": 0 };
  let inQuotes = false;
  for (const ch of headerLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\t" || ch === ";" || ch === ",")) counts[ch]++;
  }
  if (counts["\t"] > 0 && counts["\t"] >= counts[";"] && counts["\t"] >= counts[","]) return "\t";
  if (counts[";"] > counts[","]) return ";";
  return ",";
}

/**
 * Parses CSV (or tab-separated text pasted from a spreadsheet) into rows,
 * reading month headers and amounts in the forms listed above, and reports
 * what it could not read instead of dropping it silently.
 */
export function parseBudgetCsv(raw: string): ParsedBudgetCsv {
  // Strip UTF-8 BOM that Excel and some tools prepend.
  const stripped = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  // Records, not physical lines: a quoted name can hold a line break.
  let lines = splitRecords(stripped);
  let forced: CsvDelimiter | null = null;
  // Excel's "sep=;" hint line.
  const sepHint = lines[0]?.text.trim().match(/^"?sep=(.)"?$/i);
  if (sepHint) {
    const ch = sepHint[1]!;
    forced = ch === ";" ? ";" : ch === "\t" ? "\t" : ",";
    lines = lines.slice(1);
  }

  const empty: ParsedBudgetCsv = {
    rows: [],
    delimiter: forced ?? ",",
    monthColumns: [],
    ignoredColumns: [],
    invalidCells: [],
    duplicateMonthColumns: [],
    analysisExport: null,
  };
  const headerIndex = lines.findIndex((l) => l.text.trim().length > 0);
  if (headerIndex === -1) return empty;
  const delimiter = forced ?? detectDelimiter(lines[headerIndex]!.text);
  const headerCells = parseCsvLine(lines[headerIndex]!.text, delimiter);
  const analysisExport =
    (headerCells[1] ?? "").trim().match(/^Category Name \((Spent|Balance)\)$/i)?.[1] ?? null;

  const columns = headerCells.slice(2).map((header) => ({
    header: header.trim(),
    month: parseMonthHeader(header),
  }));
  const monthColumns = columns
    .filter((c): c is { header: string; month: string } => c.month !== null)
    .map((c) => ({ header: c.header, month: c.month }));
  const ignoredColumns = columns
    .filter((c) => c.month === null && c.header !== "")
    .map((c) => c.header);
  const headersByMonth = new Map<string, string[]>();
  for (const c of monthColumns) headersByMonth.set(c.month, [...(headersByMonth.get(c.month) ?? []), c.header]);
  const duplicateMonthColumns = [...headersByMonth.entries()]
    .filter(([, headers]) => headers.length > 1)
    .map(([month, headers]) => ({ month, headers }));

  const rows: BudgetCsvRow[] = [];
  const invalidCells: InvalidImportCell[] = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const record = lines[i]!;
    if (record.text.trim().length === 0) continue;
    const cells = parseCsvLine(record.text, delimiter);
    const groupName = readLiteralText((cells[0] ?? "").trim());
    const categoryName = readLiteralText((cells[1] ?? "").trim());
    if (!groupName && !categoryName) continue;

    const monthValues: Record<string, string> = {};
    for (let j = 0; j < columns.length; j++) {
      const column = columns[j]!;
      const value = (cells[j + 2] ?? "").trim();
      if (!column.month || value === "") continue;
      if (parseImportAmount(value) === null) {
        invalidCells.push({
          line: record.line,
          groupName,
          categoryName,
          header: column.header,
          value,
        });
        continue;
      }
      monthValues[column.month] = value;
    }

    rows.push({ groupName, categoryName, monthValues });
  }

  return {
    rows,
    delimiter,
    monthColumns,
    ignoredColumns,
    invalidCells,
    duplicateMonthColumns,
    analysisExport,
  };
}

/**
 * Parses raw CSV text into BudgetCsvRows (see `parseBudgetCsv` for the
 * accepted forms and for what was skipped).
 */
export function parseCsv(raw: string): BudgetCsvRow[] {
  return parseBudgetCsv(raw).rows;
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
  categoriesById: Record<string, LoadedCategory>,
  /**
   * Server state per target month. Each entry's `previousBudgeted` must be
   * that month's saved value (H4); `categoriesById` is only the fallback for
   * a month that could not be loaded.
   */
  monthStates: Record<string, LoadedMonthState | undefined> = {}
): ImportPreviewEntry[] {
  const entries: ImportPreviewEntry[] = [];

  for (const result of approved) {
    if (!result.matchedCategoryId) continue;

    for (const [month, decimalStr] of Object.entries(result.csvRow.monthValues)) {
      const avail = result.monthAvailability[month];
      if (avail !== "available") continue;

      const nextBudgeted = parseImportAmount(decimalStr);
      if (nextBudgeted === null) continue;

      // The saved value for this category in this month.
      const monthState = monthStates[month];
      const cat = monthState
        ? monthState.categoriesById[result.matchedCategoryId]
        : categoriesById[result.matchedCategoryId];
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

  // The same category can appear on more than one row (or be suggested for
  // two rows). Staging keeps the last value, so the preview does the same.
  const byCell = new Map<string, ImportPreviewEntry>();
  for (const entry of entries) byCell.set(`${entry.month}:${entry.categoryId}`, entry);
  return byCell.size === entries.length ? entries : [...byCell.values()];
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function makeMatchKey(groupName: string, categoryName: string): string {
  return `${groupName.trim().toLowerCase()}:${categoryName.trim().toLowerCase()}`;
}

/** Escapes a cell: quoted when it holds the delimiter, a quote, or a newline. */
function escapeCell(value: string, delimiter: CsvDelimiter = ","): string {
  if (value.includes(delimiter) || /["\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Splits text into records at line breaks outside quoted fields, keeping each
 * record's 1-based starting line for messages.
 */
function splitRecords(text: string): { text: string; line: number }[] {
  const records: { text: string; line: number }[] = [];
  let start = 0;
  let line = 1;
  let startLine = 1;
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "\n") {
      if (!inQuotes) {
        const end = i > start && text[i - 1] === "\r" ? i - 1 : i;
        records.push({ text: text.slice(start, end), line: startLine });
        start = i + 1;
        startLine = line + 1;
      }
      line++;
    }
  }
  records.push({ text: text.slice(start).replace(/\r$/, ""), line: startLine });
  return records;
}

/** Parses a single record, handling quoted fields. */
function parseCsvLine(line: string, delimiter: CsvDelimiter = ","): string[] {
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
    if (ch === delimiter && !inQuotes) {
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
