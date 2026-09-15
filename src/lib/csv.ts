/**
 * Shared CSV utilities used across all feature import/export pipelines.
 * Single source of truth — do not duplicate these in feature components.
 */

/**
 * Parse a single CSV line respecting RFC 4180 double-quoted fields.
 * Handles escaped quotes ("") within quoted fields.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { fields.push(current); current = ""; }
      else { current += ch; }
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Wrap a CSV field value in double-quotes if it contains commas, quotes, or newlines.
 * Returns an empty string for null/undefined values.
 */
export function csvField(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

/**
 * Parse a boolean-ish string ("true", "1", "yes" → true; everything else → false).
 */
export function parseBoolean(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Maximum file size accepted by all CSV import handlers (5 MB). */
export const CSV_MAX_BYTES = 5 * 1024 * 1024;

/**
 * One CSV cell, formula-injection guarded and then quoted if it needs to be.
 *
 * Distinct from `csvField` above, which only quotes. Use this wherever the
 * values are things people typed - payee names, category names, notes - because
 * a leading `=`, `+`, `-`, `@`, tab or carriage return can execute as a formula
 * when the file is opened in Excel or Sheets. Such a cell gets an apostrophe in
 * front, which the spreadsheet strips on display.
 *
 * Genuine numbers are left alone: `-300.00` is a negative amount, not an
 * attack, and guarding it would stop the numeric columns parsing.
 */
export function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  const isNumber = /^-?\d+(\.\d+)?$/.test(s);
  const guarded = !isNumber && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Rows to a CSV document, CRLF separated as the format expects. */
export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/**
 * Hand the browser a CSV to save. A no-op without a document, so callers need
 * not guard for the server.
 */
export function downloadCsv(
  filename: string,
  rows: readonly (readonly unknown[])[]
): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(
    new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
