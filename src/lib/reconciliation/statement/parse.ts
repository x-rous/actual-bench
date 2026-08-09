/**
 * Statement tokenizing: text in, a delimited table out (RD-071 §5, S5).
 *
 * This layer knows nothing about what the columns *mean* — that is
 * `normalize.ts`'s job. It only splits text into rows and cells, sniffs the
 * delimiter, and decides whether the first row is a header.
 *
 * Registered formats in V1 are `csv` and `clipboard-tsv`; OFX/QFX/QIF plug in
 * here later without touching anything downstream.
 */

import { parseCsvLine } from "@/lib/csv";

export type StatementDelimiter = "," | "\t" | ";" | "|";

export type DelimitedTable = {
  delimiter: StatementDelimiter;
  /** Header cells when the first row was detected as a header, else null. */
  headers: string[] | null;
  /** Data rows only — the header row is not included. */
  rows: string[][];
  /**
   * 1-based source line number of each entry in `rows`, so an error can say
   * "row 42 of your file" rather than "row 41 of the rows I kept".
   */
  sourceRowNumbers: number[];
};

const DELIMITERS: StatementDelimiter[] = [",", "\t", ";", "|"];

/**
 * Pick the delimiter that splits the sample lines most *consistently*.
 *
 * Raw frequency is not enough: a description column full of commas can beat a
 * genuine tab separator. Consistency of field count across lines is the real
 * signal, with frequency as the tiebreak.
 */
export function sniffDelimiter(text: string): StatementDelimiter {
  const lines = splitLines(text).slice(0, 20);
  if (lines.length === 0) return ",";

  let best: { delimiter: StatementDelimiter; consistency: number; fields: number } = {
    delimiter: ",",
    consistency: -1,
    fields: 0,
  };

  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => splitLine(line, delimiter).length);
    const maxFields = Math.max(...counts);
    if (maxFields < 2) continue;

    const modal = mode(counts);
    const consistency = counts.filter((count) => count === modal).length / counts.length;

    const better =
      consistency > best.consistency ||
      (consistency === best.consistency && modal > best.fields);
    if (better) best = { delimiter, consistency, fields: modal };
  }

  return best.consistency < 0 ? "," : best.delimiter;
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let bestValue = values[0] ?? 0;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && value > bestValue)) {
      bestValue = value;
      bestCount = count;
    }
  }
  return bestValue;
}

/** Split into lines, tolerating CRLF and dropping blank lines. */
export function splitLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

/**
 * Split one line into cells.
 *
 * Comma-delimited lines go through the shared RFC 4180 parser so quoted fields
 * containing commas survive. Other delimiters are rarely quoted in practice, but
 * quotes are still stripped so a quoted tab-separated paste behaves.
 */
export function splitLine(line: string, delimiter: StatementDelimiter): string[] {
  if (delimiter === ",") return parseCsvLine(line);
  return line.split(delimiter).map(unquote);
}

function unquote(cell: string): string {
  const trimmed = cell.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

/**
 * Decide whether the first row is a header.
 *
 * A header row is one where no cell parses as a date *and* no cell parses as an
 * amount — a data row will always have at least one of each. This is more
 * reliable than looking for known column names, which are bank- and
 * language-specific.
 */
export function looksLikeHeader(cells: string[]): boolean {
  if (cells.length === 0) return false;
  const hasData = cells.some((cell) => looksLikeDate(cell) || looksLikeAmount(cell));
  if (hasData) return false;
  // Guard against a row of empty cells being called a header.
  return cells.some((cell) => cell.trim().length > 0);
}

/** Loose date detection for header sniffing — not a parser. */
export function looksLikeDate(cell: string): boolean {
  const value = cell.trim();
  if (!value) return false;
  return (
    /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(value) ||
    /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(value) ||
    /^\d{1,2}[-\s][A-Za-z]{3,}[-\s]\d{2,4}$/.test(value)
  );
}

/** Loose amount detection for header sniffing — not a parser. */
export function looksLikeAmount(cell: string): boolean {
  const value = cell.trim();
  if (!value) return false;
  // At least one digit, and nothing but money-ish characters.
  return /\d/.test(value) && /^[()\-+\s\d.,'’ ]*[A-Za-z]{0,3}$/.test(value);
}

/** Tokenize statement text into a delimited table. */
export function parseStatementText(
  text: string,
  options: { delimiter?: StatementDelimiter } = {}
): DelimitedTable {
  const delimiter = options.delimiter ?? sniffDelimiter(text);
  const lines = splitLines(text);
  const all = lines.map((line) => splitLine(line, delimiter));

  if (all.length === 0) {
    return { delimiter, headers: null, rows: [], sourceRowNumbers: [] };
  }

  const headerDetected = looksLikeHeader(all[0]);
  const headers = headerDetected ? all[0].map((cell) => cell.trim()) : null;
  const dataRows = headerDetected ? all.slice(1) : all;

  // Source row numbers are 1-based over the non-blank lines, counting the
  // header when there is one.
  const offset = headerDetected ? 2 : 1;
  return {
    delimiter,
    headers,
    rows: dataRows,
    sourceRowNumbers: dataRows.map((_, i) => i + offset),
  };
}
