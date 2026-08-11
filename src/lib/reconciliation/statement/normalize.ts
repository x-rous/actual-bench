/**
 * Statement normalization: delimited cells in, `StatementRow`s out (RD-071 §5).
 *
 * This is the single conversion point from statement text to integer minor
 * units and ISO dates. AGENTS.md §6 forbids binary floating point for money, so
 * amounts are parsed with string/integer arithmetic only — never
 * `Math.round(parseFloat(x) * 100)`, which mis-rounds values like `1.005`.
 */

import { fnv1aHex } from "@/lib/sync/hash";
import type { MinorUnitAmount, StatementRow } from "../types";
import type { DelimitedTable } from "./parse";

export type StatementDateFormat =
  | "iso"          // 2026-07-03
  | "dmy"          // 03/07/2026
  | "mdy"          // 07/03/2026
  | "dmy-name"     // 03 Jul 2026 / 03-Jul-26
  | "ymd-compact"; // 20260703

/**
 * How the statement expresses direction.
 *
 * - `signed`: one amount column already carrying the sign.
 * - `debit-credit`: separate columns; debits become negative.
 * - `signed-inverted`: one column whose sign is the opposite of Actual's
 *   convention (some card statements report spend as positive).
 */
export type SignConvention = "signed" | "debit-credit" | "signed-inverted";

export type ColumnMapping = {
  date: number;
  description: number;
  /** Required when `signConvention` is `signed` or `signed-inverted`. */
  amount?: number;
  /** Required when `signConvention` is `debit-credit`. */
  debit?: number;
  credit?: number;
  reference?: number;
  dateFormat: StatementDateFormat;
  signConvention: SignConvention;
  decimalSeparator: "." | ",";
  /**
   * Digits in the currency's minor unit. Actual stores 2-decimal integer minor
   * units, so this is 2 unless a profile is explicitly told otherwise.
   */
  minorUnitDigits: number;
  /**
   * Recover the original-currency amount the bank printed in the description of
   * a foreign-currency transaction. On by default: it costs one regex per row
   * and it is the difference between matching a foreign purchase exactly and
   * not matching it at all.
   */
  detectOriginalCurrencyAmount: boolean;
};

export const DEFAULT_MAPPING: Omit<ColumnMapping, "date" | "description"> = {
  amount: undefined,
  debit: undefined,
  credit: undefined,
  reference: undefined,
  dateFormat: "iso",
  signConvention: "signed",
  decimalSeparator: ".",
  minorUnitDigits: 2,
  detectOriginalCurrencyAmount: true,
};

export type StatementRowError = {
  sourceRowNumber: number;
  /** The offending cells, kept so the user can see what failed. */
  cells: string[];
  reason: "unparseable-date" | "unparseable-amount" | "missing-column";
  detail: string;
};

export type NormalizedStatement = {
  rows: StatementRow[];
  errors: StatementRowError[];
  /** Totals over the successfully parsed rows, for the parse preview. */
  totals: StatementTotals;
  /** Earliest/latest posted date across parsed rows, or null when empty. */
  period: { start: string; end: string } | null;
};

export type StatementTotals = {
  debits: MinorUnitAmount;
  credits: MinorUnitAmount;
  net: MinorUnitAmount;
  rowCount: number;
};

/**
 * Trailing original-currency amount printed by the bank on a foreign-currency
 * transaction, e.g. `... KHOBAR SAU SAR225.70` or `AIRALO AMSTERDAM NH USD24.50`.
 *
 * This matters more than it looks. When a card transaction is made abroad, an
 * SMS/automation-created transaction in Actual usually carries the **original**
 * amount, while the statement posts the **converted** amount. The two never
 * match on the posted figure — but the bank prints the original amount right
 * there in the description, so it can be recovered exactly rather than guessed
 * at with a tolerance.
 */
const ORIGINAL_AMOUNT_PATTERN = /\b([A-Z]{3})\s?(\d*\.?\d+)\s*$/;

export function extractOriginalAmount(
  description: string,
  minorUnitDigits = 2
): { currency: string; amount: MinorUnitAmount } | null {
  const match = ORIGINAL_AMOUNT_PATTERN.exec(description.trim());
  if (!match) return null;
  const amount = parseMoneyToMinorUnits(match[2], ".", minorUnitDigits);
  if (amount === null || amount === 0) return null;
  return { currency: match[1], amount };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse statement money text into integer minor units.
 *
 * Handles currency symbols and codes, thousands separators, both decimal
 * conventions, parenthesised negatives, and trailing `DR`/`CR` markers.
 * Returns `null` when the text carries no parseable number.
 */
export function parseMoneyToMinorUnits(
  text: string,
  decimalSeparator: "." | "," = ".",
  minorUnitDigits = 2
): MinorUnitAmount | null {
  if (text == null) return null;
  let value = String(text).trim();
  if (!value) return null;

  let negative = false;

  // (1,234.56) is an accounting negative.
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }

  // Trailing DR/CR markers, e.g. "1,234.56 DR".
  const marker = value.match(/\b(DR|CR)\b\s*$/i);
  if (marker) {
    if (marker[1].toUpperCase() === "DR") negative = true;
    value = value.slice(0, marker.index).trim();
  }

  if (value.startsWith("-")) {
    negative = !negative;
    value = value.slice(1).trim();
  } else if (value.startsWith("+")) {
    value = value.slice(1).trim();
  }

  // Drop currency symbols/codes and any remaining spaces.
  value = value.replace(/[^\d.,'’  ]/g, "").replace(/[\s '’]/g, "");
  if (!value || !/\d/.test(value)) return null;

  const groupSeparator = decimalSeparator === "." ? "," : ".";
  value = value.split(groupSeparator).join("");

  const parts = value.split(decimalSeparator);
  if (parts.length > 2) return null;

  const whole = parts[0] === "" ? "0" : parts[0];
  const fractionRaw = parts[1] ?? "";
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fractionRaw)) return null;

  // Pad or truncate to the currency's minor-unit width using string ops, so no
  // binary floating point is involved at any point.
  const fraction = fractionRaw
    .slice(0, minorUnitDigits)
    .padEnd(minorUnitDigits, "0");

  const scale = 10 ** minorUnitDigits;
  const magnitude = Number(whole) * scale + (minorUnitDigits > 0 ? Number(fraction) : 0);
  if (!Number.isFinite(magnitude)) return null;

  return negative ? -magnitude : magnitude;
}

/**
 * Guess the column mapping from the parsed table.
 *
 * Getting this wrong is not a small inconvenience: mapping a **Debit** column as
 * a signed amount yields positive amounts for money that left the account, and
 * since automatic matching requires the exact *signed* amount, every single row
 * then fails to match. So debit/credit layouts are detected explicitly, from the
 * header names when present and otherwise from the shape of the data — two
 * numeric columns where each row populates only one of them.
 */
export function detectColumnMapping(table: DelimitedTable): ColumnMapping {
  const headers = (table.headers ?? []).map((header) => header.trim().toLowerCase());
  const width = Math.max(table.headers?.length ?? 0, ...table.rows.map((row) => row.length), 0);

  const headerIndex = (...names: string[]) =>
    headers.findIndex((header) => names.some((name) => header === name || header.includes(name)));

  const numericColumns: number[] = [];
  for (let column = 0; column < width; column++) {
    const values = table.rows.slice(0, 40).map((row) => row[column] ?? "");
    const parsed = values.filter((value) => parseMoneyToMinorUnits(value) !== null);
    if (values.length > 0 && parsed.length >= values.length * 0.8) numericColumns.push(column);
  }

  const dateColumn = (() => {
    const byHeader = headerIndex("date");
    if (byHeader >= 0) return byHeader;
    for (let column = 0; column < width; column++) {
      const values = table.rows.slice(0, 20).map((row) => row[column] ?? "");
      if (values.every((value) => looksLikeDateCell(value))) return column;
    }
    return 0;
  })();

  const debitHeader = headerIndex("debit", "withdrawal", "money out");
  const creditHeader = headerIndex("credit", "deposit", "money in");

  // Two numeric columns where each row fills exactly one is the classic
  // debit/credit layout even when the headers are unhelpful.
  const complementaryPair = (() => {
    for (let i = 0; i < numericColumns.length; i++) {
      for (let j = i + 1; j < numericColumns.length; j++) {
        const a = numericColumns[i];
        const b = numericColumns[j];
        const rows = table.rows.slice(0, 40);
        if (rows.length === 0) continue;
        const exclusive = rows.filter((row) => {
          const left = parseMoneyToMinorUnits(row[a] ?? "") ?? 0;
          const right = parseMoneyToMinorUnits(row[b] ?? "") ?? 0;
          return (left === 0) !== (right === 0);
        });
        if (exclusive.length >= rows.length * 0.9) return [a, b] as const;
      }
    }
    return null;
  })();

  const dateSamples = table.rows.slice(0, 20).map((row) => row[dateColumn] ?? "");
  const base = {
    ...DEFAULT_MAPPING,
    date: dateColumn,
    dateFormat: detectDateFormat(dateSamples),
  };

  const descriptionColumn = (() => {
    const byHeader = headerIndex("description", "narrative", "details", "particulars", "payee");
    if (byHeader >= 0) return byHeader;
    for (let column = 0; column < width; column++) {
      if (column === dateColumn || numericColumns.includes(column)) continue;
      return column;
    }
    return Math.min(dateColumn + 1, Math.max(width - 1, 0));
  })();

  if (debitHeader >= 0 && creditHeader >= 0) {
    return {
      ...base,
      description: descriptionColumn,
      debit: debitHeader,
      credit: creditHeader,
      signConvention: "debit-credit",
    };
  }

  if (complementaryPair) {
    const [first, second] = complementaryPair;
    return {
      ...base,
      description: descriptionColumn,
      debit: first,
      credit: second,
      signConvention: "debit-credit",
    };
  }

  const amountColumn =
    headerIndex("amount", "value") >= 0
      ? headerIndex("amount", "value")
      : numericColumns[0] ?? Math.max(width - 1, 0);

  return { ...base, description: descriptionColumn, amount: amountColumn };
}

function looksLikeDateCell(value: string): boolean {
  return parseStatementDate(value, "iso") !== null ||
    parseStatementDate(value, "dmy") !== null ||
    parseStatementDate(value, "mdy") !== null ||
    parseStatementDate(value, "dmy-name") !== null ||
    parseStatementDate(value, "ymd-compact") !== null;
}

/** Parse a statement date cell into ISO `YYYY-MM-DD`, or null. */
export function parseStatementDate(
  text: string,
  format: StatementDateFormat
): string | null {
  const value = String(text ?? "").trim();
  if (!value) return null;

  if (format === "ymd-compact") {
    const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
    return match ? isoDate(+match[1], +match[2], +match[3]) : null;
  }

  if (format === "dmy-name") {
    const match = value.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,})[-\s/](\d{2,4})$/);
    if (!match) return null;
    const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
    if (!month) return null;
    return isoDate(expandYear(+match[3]), month, +match[1]);
  }

  const parts = value.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/);
  if (!parts) return null;
  const [, a, b, c] = parts;

  if (format === "iso") return isoDate(+a, +b, +c);
  if (format === "dmy") return isoDate(expandYear(+c), +b, +a);
  return isoDate(expandYear(+c), +a, +b); // mdy
}

function expandYear(year: number): number {
  if (year >= 1000) return year;
  // Two-digit years: assume the current century for <= 68, previous otherwise —
  // the POSIX convention, and statements are never that old in practice.
  return year <= 68 ? 2000 + year : 1900 + year;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject impossible dates that JS would roll over (e.g. 31 Feb -> 3 Mar).
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Detect the most plausible date format from sample cells.
 *
 * Ambiguity between `dmy` and `mdy` is only resolvable when some sample has a
 * first component above 12; when nothing disambiguates, `dmy` is returned and
 * the caller is expected to show the choice in the mapping UI rather than
 * silently trusting it.
 */
export function detectDateFormat(samples: string[]): StatementDateFormat {
  const values = samples.map((s) => String(s ?? "").trim()).filter(Boolean);
  if (values.length === 0) return "iso";

  if (values.every((v) => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(v))) return "iso";
  if (values.every((v) => /^\d{8}$/.test(v))) return "ymd-compact";
  if (values.some((v) => /^\d{1,2}[-\s/][A-Za-z]{3,}/.test(v))) return "dmy-name";

  let sawDayFirst = false;
  let sawMonthFirst = false;
  for (const value of values) {
    const match = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}$/);
    if (!match) continue;
    if (+match[1] > 12) sawDayFirst = true;
    if (+match[2] > 12) sawMonthFirst = true;
  }
  if (sawMonthFirst && !sawDayFirst) return "mdy";
  return "dmy";
}

/**
 * Stable fingerprint of a source row (RD-071 A5/D14).
 *
 * Derived from the raw cells only — never from mapping config — so that
 * changing the column mapping mid-session does not silently change a row's
 * identity, and therefore cannot cause a retry to create a duplicate.
 */
export function fingerprintRow(cells: string[], sourceRowNumber: number): string {
  return fnv1aHex(`${sourceRowNumber} ${cells.join("")}`);
}

/**
 * Stable fingerprint of a whole statement, for recognising a re-import.
 *
 * Built from the rows' own fingerprints, **sorted** — the same statement
 * exported twice can arrive in a different order, and someone who reversed the
 * sort in their banking app has not produced a different statement.
 *
 * Derived from the rows rather than the file, so a statement pasted one month
 * and uploaded the next is still recognised, and re-parsing under a corrected
 * column mapping does not invent a new identity for the same document.
 *
 * Uses the same NUL/SOH separators as `fingerprintRow`, so no field's contents
 * can imitate a separator and collide with a different statement.
 */
export function fingerprintStatement(rows: { fingerprint: string }[]): string | null {
  if (rows.length === 0) return null;
  const sorted = rows.map((row) => row.fingerprint).sort();
  return fnv1aHex(`${rows.length}\x00${sorted.join("\x01")}`);
}

function cell(cells: string[], index: number | undefined): string {
  if (index == null) return "";
  return cells[index] ?? "";
}

/** Apply a column mapping to a parsed table. */
export function normalizeStatement(
  table: DelimitedTable,
  mapping: ColumnMapping,
  makeId: (index: number) => string
): NormalizedStatement {
  const rows: StatementRow[] = [];
  const errors: StatementRowError[] = [];

  table.rows.forEach((cells, index) => {
    const sourceRowNumber = table.sourceRowNumbers[index] ?? index + 1;

    const postedDate = parseStatementDate(cell(cells, mapping.date), mapping.dateFormat);
    if (!postedDate) {
      errors.push({
        sourceRowNumber,
        cells,
        reason: "unparseable-date",
        detail: `Could not read "${cell(cells, mapping.date)}" as a ${mapping.dateFormat} date`,
      });
      return;
    }

    const amount = readAmount(cells, mapping);
    if (amount === null) {
      errors.push({
        sourceRowNumber,
        cells,
        reason: "unparseable-amount",
        detail: "Could not read an amount from the mapped column(s)",
      });
      return;
    }

    const reference = cell(cells, mapping.reference).trim();
    const description = cell(cells, mapping.description).trim();
    const original = mapping.detectOriginalCurrencyAmount
      ? extractOriginalAmount(description, mapping.minorUnitDigits)
      : null;

    rows.push({
      id: makeId(index),
      sourceRowNumber,
      postedDate,
      amount,
      description,
      reference: reference || undefined,
      // Sign follows the posted amount: a foreign purchase is an outflow in both
      // currencies.
      originalAmount:
        original && amount !== 0 ? Math.sign(amount) * Math.abs(original.amount) : undefined,
      originalCurrency: original?.currency,
      raw: table.headers ? zip(table.headers, cells) : [...cells],
      fingerprint: fingerprintRow(cells, sourceRowNumber),
    });
  });

  return { rows, errors, totals: totalsFor(rows), period: periodFor(rows) };
}

function readAmount(cells: string[], mapping: ColumnMapping): MinorUnitAmount | null {
  const { decimalSeparator, minorUnitDigits } = mapping;

  if (mapping.signConvention === "debit-credit") {
    const debit = parseMoneyToMinorUnits(cell(cells, mapping.debit), decimalSeparator, minorUnitDigits);
    const credit = parseMoneyToMinorUnits(cell(cells, mapping.credit), decimalSeparator, minorUnitDigits);
    // Debit columns are written as positive magnitudes; money leaving the
    // account is negative in Actual.
    if (debit !== null && debit !== 0) return -Math.abs(debit);
    if (credit !== null && credit !== 0) return Math.abs(credit);
    // A genuine zero-value row is legitimate; only "no number at all" is an error.
    if (debit === 0 || credit === 0) return 0;
    return null;
  }

  const amount = parseMoneyToMinorUnits(cell(cells, mapping.amount), decimalSeparator, minorUnitDigits);
  if (amount === null) return null;
  return mapping.signConvention === "signed-inverted" ? -amount : amount;
}

function zip(headers: string[], cells: string[]): Record<string, string> {
  const raw: Record<string, string> = {};
  headers.forEach((header, i) => {
    raw[header || `column${i + 1}`] = cells[i] ?? "";
  });
  return raw;
}

export function totalsFor(rows: StatementRow[]): StatementTotals {
  let debits = 0;
  let credits = 0;
  for (const row of rows) {
    if (row.amount < 0) debits += row.amount;
    else credits += row.amount;
  }
  return { debits, credits, net: debits + credits, rowCount: rows.length };
}

function periodFor(rows: StatementRow[]): { start: string; end: string } | null {
  if (rows.length === 0) return null;
  let start = rows[0].postedDate;
  let end = rows[0].postedDate;
  for (const row of rows) {
    if (row.postedDate < start) start = row.postedDate;
    if (row.postedDate > end) end = row.postedDate;
  }
  return { start, end };
}
