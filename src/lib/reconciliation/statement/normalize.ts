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

/** Which source format a statement was read from (RD-072 §2.5). */
export type StatementFormat = "delimited" | "ofx" | "qif";

/**
 * Which column carries what, for a delimited statement.
 *
 * Indexes only. How the *values* in those columns are read — date format, sign
 * convention, decimal separator — belongs to `StatementParseConfig`, because
 * those conventions apply to structured formats too, where there are no columns
 * at all.
 */
export type ColumnMapping = {
  date: number;
  /**
   * The bank's merchant/payee/description column.
   *
   * Optional, though detection always proposes one: a statement whose only text
   * column is genuinely a memo should be able to say so and map it to `notes`
   * alone. Leaving this unset yields an empty merchant channel — no
   * `imported_payee` is written, no payee is resolved from it, and matching
   * compares the memo instead (RD-072 §2.1).
   */
  importedPayee?: number;
  /** A *separate* memo/details column, when the statement has one. */
  notes?: number;
  /** Required when `signConvention` is `signed` or `signed-inverted`. */
  amount?: number;
  /** Required when `signConvention` is `debit-credit`. */
  debit?: number;
  credit?: number;
  reference?: number;
};

/**
 * Everything needed to turn a statement file into `StatementRow`s.
 *
 * One shape across all formats. The delimited-only and structured-only members
 * are both present rather than split into a union, because the import UI edits
 * one object and a saved profile stores one object — and a user who imports a
 * CSV this month and an OFX the next should not lose their decimal convention
 * on the way.
 */
export type StatementParseConfig = {
  format: StatementFormat;
  /** Delimited only. */
  columns: ColumnMapping;
  /** Delimited and QIF; OFX dates are unambiguous and ignore this. */
  dateFormat: StatementDateFormat;
  /** Delimited only: structured formats state the sign themselves. */
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
  /**
   * Structured formats: this bank puts the merchant in the memo field and
   * something else in the payee field. Mirrors Actual's `swapPayeeAndMemo` — a
   * bank-specific repair, not a change in what the fields mean.
   */
  swapPayeeAndMemo: boolean;
  /**
   * Structured formats: when the payee field is empty, promote the memo to the
   * payee. Mirrors Actual's `fallbackMissingPayeeToMemo`, including its rule
   * that a memo *consumed* this way does not also become the note.
   */
  fallbackPayeeToMemo: boolean;
};

export const DEFAULT_COLUMN_MAPPING: ColumnMapping = {
  date: 0,
  importedPayee: 1,
  notes: undefined,
  amount: undefined,
  debit: undefined,
  credit: undefined,
  reference: undefined,
};

export const DEFAULT_PARSE_CONFIG: StatementParseConfig = {
  format: "delimited",
  columns: DEFAULT_COLUMN_MAPPING,
  dateFormat: "iso",
  signConvention: "signed",
  decimalSeparator: ".",
  minorUnitDigits: 2,
  detectOriginalCurrencyAmount: true,
  swapPayeeAndMemo: false,
  fallbackPayeeToMemo: true,
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
 * Header families for the two text channels (RD-072 §2.1).
 *
 * Deliberately asymmetric, and deliberately ordered: the **payee** column is
 * chosen first, from the whole table, and the memo is then chosen from what is
 * left. Claiming a merchant column as the memo is the expensive mistake — it
 * leaves the imported payee empty, and an empty imported payee matches nothing
 * and writes no provenance — while a memo column mistaken for the merchant is
 * merely untidy.
 *
 * That ordering is also what makes ambiguous labels behave. `Transaction
 * Details` beside a `Memo` column reads as the merchant and the memo in that
 * order, which is how banks that use both actually mean them; matching the memo
 * family first would have reversed the pair.
 *
 * Exact header names win over substring hits within each family, so
 * `Description` beside `Transaction Details` still takes the description.
 */
const MEMO_HEADERS = [
  "memo",
  "notes",
  "note",
  "remarks",
  "remark",
  "additional information",
  "additional info",
  "transaction details",
  "transaction information",
  "reference text",
  "comment",
  "comments",
];

const PAYEE_HEADERS = [
  "payee",
  "merchant",
  "description",
  "narrative",
  "counterparty",
  "beneficiary",
  "details",
  "particulars",
  "transaction",
];

/**
 * Guess the parse configuration from the parsed table.
 *
 * Getting this wrong is not a small inconvenience: mapping a **Debit** column as
 * a signed amount yields positive amounts for money that left the account, and
 * since automatic matching requires the exact *signed* amount, every single row
 * then fails to match. So debit/credit layouts are detected explicitly, from the
 * header names when present and otherwise from the shape of the data — two
 * numeric columns where each row populates only one of them.
 */
export function detectDelimitedConfig(table: DelimitedTable): StatementParseConfig {
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
  const referenceColumn = (() => {
    const byHeader = headerIndex("reference", "ref no", "auth", "cheque", "check no");
    return byHeader >= 0 ? byHeader : undefined;
  })();

  /** A text column this file could plausibly map to one of the two channels. */
  const isTextColumn = (column: number, taken: number | undefined) =>
    column !== dateColumn &&
    column !== referenceColumn &&
    column !== taken &&
    !numericColumns.includes(column);

  /** Exact header name first, then a substring hit; both skip non-text columns. */
  const matchHeader = (family: string[], taken: number | undefined) => {
    const exact = headers.findIndex(
      (header, index) => isTextColumn(index, taken) && family.includes(header)
    );
    if (exact >= 0) return exact;
    const partial = headers.findIndex(
      (header, index) => isTextColumn(index, taken) && family.some((name) => header.includes(name))
    );
    return partial >= 0 ? partial : undefined;
  };

  const payeeColumn =
    matchHeader(PAYEE_HEADERS, undefined) ??
    // No usable header: the first column that is neither the date, an amount,
    // nor the reference. Something has to fill this channel.
    (() => {
      for (let column = 0; column < width; column++) {
        if (isTextColumn(column, undefined)) return column;
      }
      return Math.min(dateColumn + 1, Math.max(width - 1, 0));
    })();

  // Only ever a column the payee did not take, so one column can never fill both
  // channels — duplicating the merchant text into the notes is exactly the
  // conflation this model exists to remove.
  const memoColumn = matchHeader(MEMO_HEADERS, payeeColumn);

  const columns: ColumnMapping = {
    date: dateColumn,
    importedPayee: payeeColumn,
    notes: memoColumn,
    reference: referenceColumn === payeeColumn ? undefined : referenceColumn,
  };

  const base: StatementParseConfig = {
    ...DEFAULT_PARSE_CONFIG,
    columns,
    dateFormat: detectDateFormat(dateSamples),
  };

  if (debitHeader >= 0 && creditHeader >= 0) {
    return {
      ...base,
      columns: { ...columns, debit: debitHeader, credit: creditHeader },
      signConvention: "debit-credit",
    };
  }

  if (complementaryPair) {
    const [first, second] = complementaryPair;
    return {
      ...base,
      columns: { ...columns, debit: first, credit: second },
      signConvention: "debit-credit",
    };
  }

  const amountColumn =
    headerIndex("amount", "value") >= 0
      ? headerIndex("amount", "value")
      : numericColumns[0] ?? Math.max(width - 1, 0);

  return { ...base, columns: { ...columns, amount: amountColumn } };
}

function looksLikeDateCell(value: string): boolean {
  return parseStatementDate(value, "iso") !== null ||
    parseStatementDate(value, "dmy") !== null ||
    parseStatementDate(value, "mdy") !== null ||
    parseStatementDate(value, "dmy-name") !== null ||
    parseStatementDate(value, "ymd-compact") !== null;
}

/**
 * Tidy a date cell into the shape the format patterns expect.
 *
 * Quicken writes QIF dates as `8/12'26` and pads them as `8/ 1/26`; both are the
 * ordinary separated form once the apostrophe and the padding are gone, so they
 * are normalized here rather than given a format of their own.
 *
 * Shared by the parser **and** the detector on purpose: a cell the detector
 * cannot recognise but the parser can — or the reverse — is how a file ends up
 * detected as one format and read as another.
 */
export function normalizeDateText(text: string): string {
  return String(text ?? "")
    .trim()
    .replace(/'/g, "/")
    .replace(/\s*\/\s*/g, "/");
}

/** Parse a statement date cell into ISO `YYYY-MM-DD`, or null. */
export function parseStatementDate(
  text: string,
  format: StatementDateFormat
): string | null {
  const value = normalizeDateText(text);
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
 * silently trusting it — see `isDateFormatAmbiguous`.
 */
export function detectDateFormat(samples: string[]): StatementDateFormat {
  const values = dateSamples(samples);
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
 * True when the samples cannot settle day-first versus month-first.
 *
 * `03/07/2026` is either the 3rd of July or the 7th of March, and no amount of
 * inspection resolves it — only a sample with a component above 12 does. Where a
 * whole statement happens to fall in the first twelve days of each month,
 * detection has to guess, and every row is mis-dated if it guesses wrong.
 *
 * So the ambiguity is reported rather than hidden. It is the caller's job to say
 * so next to the format selector; the detector's job is only to be honest about
 * what the data supports.
 */
export function isDateFormatAmbiguous(samples: string[]): boolean {
  const values = dateSamples(samples);
  if (values.length === 0) return false;

  let separated = 0;
  for (const value of values) {
    const match = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}$/);
    if (!match) continue;
    separated += 1;
    // Either component above 12 settles it for the whole file.
    if (+match[1] > 12 || +match[2] > 12) return false;
  }
  return separated > 0;
}

/** Trimmed, non-empty samples in the shape the format patterns expect. */
function dateSamples(samples: string[]): string[] {
  return samples.map((sample) => normalizeDateText(sample)).filter(Boolean);
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

/**
 * The original-currency amount, resolved from whichever text channel the bank
 * printed it in and signed to follow the posted amount.
 *
 * Shared with the structured parsers: a foreign purchase is an outflow in both
 * currencies, and which field the bank chose to print the original amount in is
 * a formatting decision, not a semantic one.
 */
export function originalAmountFor(
  texts: (string | undefined)[],
  amount: MinorUnitAmount,
  config: Pick<StatementParseConfig, "detectOriginalCurrencyAmount" | "minorUnitDigits">
): { originalAmount?: MinorUnitAmount; originalCurrency?: string } {
  if (!config.detectOriginalCurrencyAmount) return {};
  for (const text of texts) {
    if (!text) continue;
    const original = extractOriginalAmount(text, config.minorUnitDigits);
    if (!original) continue;
    return {
      originalAmount: amount !== 0 ? Math.sign(amount) * Math.abs(original.amount) : undefined,
      originalCurrency: original.currency,
    };
  }
  return {};
}

/** Apply a parse config to a delimited table. */
export function normalizeStatement(
  table: DelimitedTable,
  config: StatementParseConfig,
  makeId: (index: number) => string
): NormalizedStatement {
  const rows: StatementRow[] = [];
  const errors: StatementRowError[] = [];
  const columns = config.columns;

  table.rows.forEach((cells, index) => {
    const sourceRowNumber = table.sourceRowNumbers[index] ?? index + 1;

    const postedDate = parseStatementDate(cell(cells, columns.date), config.dateFormat);
    if (!postedDate) {
      errors.push({
        sourceRowNumber,
        cells,
        reason: "unparseable-date",
        detail: `Could not read "${cell(cells, columns.date)}" as a ${config.dateFormat} date`,
      });
      return;
    }

    const amount = readAmount(cells, config);
    if (amount === null) {
      errors.push({
        sourceRowNumber,
        cells,
        reason: "unparseable-amount",
        detail: "Could not read an amount from the mapped column(s)",
      });
      return;
    }

    const reference = cell(cells, columns.reference).trim();
    const importedPayee = cell(cells, columns.importedPayee).trim();
    const bankNotes = cell(cells, columns.notes).trim();

    rows.push({
      id: makeId(index),
      sourceRowNumber,
      postedDate,
      amount,
      importedPayee,
      bankNotes: bankNotes || undefined,
      bankReference: reference || undefined,
      // The bank prints the foreign amount in whichever text column it feels
      // like; the payee text is by far the commoner of the two.
      ...originalAmountFor([importedPayee, bankNotes], amount, config),
      raw: table.headers ? zip(table.headers, cells) : [...cells],
      fingerprint: fingerprintRow(cells, sourceRowNumber),
    });
  });

  return { rows, errors, totals: totalsFor(rows), period: periodFor(rows) };
}

function readAmount(cells: string[], config: StatementParseConfig): MinorUnitAmount | null {
  const { decimalSeparator, minorUnitDigits, columns } = config;

  if (config.signConvention === "debit-credit") {
    const debit = parseMoneyToMinorUnits(cell(cells, columns.debit), decimalSeparator, minorUnitDigits);
    const credit = parseMoneyToMinorUnits(cell(cells, columns.credit), decimalSeparator, minorUnitDigits);
    // Debit columns are written as positive magnitudes; money leaving the
    // account is negative in Actual.
    if (debit !== null && debit !== 0) return -Math.abs(debit);
    if (credit !== null && credit !== 0) return Math.abs(credit);
    // A genuine zero-value row is legitimate; only "no number at all" is an error.
    if (debit === 0 || credit === 0) return 0;
    return null;
  }

  const amount = parseMoneyToMinorUnits(cell(cells, columns.amount), decimalSeparator, minorUnitDigits);
  if (amount === null) return null;
  return config.signConvention === "signed-inverted" ? -amount : amount;
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

export function periodFor(rows: StatementRow[]): { start: string; end: string } | null {
  if (rows.length === 0) return null;
  let start = rows[0].postedDate;
  let end = rows[0].postedDate;
  for (const row of rows) {
    if (row.postedDate < start) start = row.postedDate;
    if (row.postedDate > end) end = row.postedDate;
  }
  return { start, end };
}
