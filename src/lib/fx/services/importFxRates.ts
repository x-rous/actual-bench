import type { SqliteDatabase } from "@/lib/app-db/types";
import { isValidCurrency, isValidDate } from "../validation";
import { isValidRate } from "../fxMath";
import {
  findActiveFxRate,
  insertFxRate,
  replaceActiveFxRate,
} from "../repositories/fxRateRepository";
import { createFxImportBatch, updateFxImportBatch } from "../repositories/fxRateImportBatchRepository";
import type { FxRateImportBatch } from "../types";

/**
 * CSV rate import (RD-056 / PR-025d, FX doc §17). Parse → validate → categorize
 * (insert / replace / skip / invalid) → preview, then commit as one batch with
 * versioned replacement. Uploaded rates are `user-upload`.
 *
 * Expected header: `date,base_currency,quote_currency,rate[,notes]`.
 */

export type FxImportCategory = "insert" | "replace" | "skip" | "invalid";

export type FxCsvRow = {
  line: number;
  date: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  notes: string | null;
};

export type FxImportRow = { row: FxCsvRow; category: FxImportCategory; reason: string | null };
export type FxImportPreview = {
  rows: FxImportRow[];
  counts: { insert: number; replace: number; skip: number; invalid: number };
};

export type FxImportOptions = {
  /** Uploaded rates supersede active provider/upload rates for the same pair+date (default true). */
  overrideProvider?: boolean;
  /** Also overwrite an active manual override (default false — protect manual edits). */
  overrideManual?: boolean;
  nowMs?: number;
};

/** Parse the CSV text into normalized rows. Malformed lines become `invalid`. */
export function parseFxCsv(text: string): FxCsvRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  // Skip a header row if present.
  const start = /date/i.test(lines[0]) && /rate/i.test(lines[0]) ? 1 : 0;
  const rows: FxCsvRow[] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    rows.push({
      line: i + 1,
      date: cols[0] ?? "",
      baseCurrency: (cols[1] ?? "").toUpperCase(),
      quoteCurrency: (cols[2] ?? "").toUpperCase(),
      rate: cols[3] ?? "",
      notes: cols.length > 4 ? cols.slice(4).join(",") : null,
    });
  }
  return rows;
}

function validateRow(row: FxCsvRow): string | null {
  if (!isValidDate(row.date)) return "Invalid date (expected YYYY-MM-DD).";
  if (!isValidCurrency(row.baseCurrency) || !isValidCurrency(row.quoteCurrency)) return "Invalid ISO 4217 currency code.";
  if (row.baseCurrency === row.quoteCurrency) return "Base and quote currencies must differ.";
  if (!isValidRate(row.rate)) return "Rate must be a positive number.";
  return null;
}

/** Validate + categorize rows against the current registry, without writing. */
export function previewFxImport(db: SqliteDatabase, rows: FxCsvRow[], options: FxImportOptions = {}): FxImportPreview {
  const overrideProvider = options.overrideProvider ?? true;
  const overrideManual = options.overrideManual ?? false;
  const seenInFile = new Set<string>();
  const out: FxImportRow[] = [];

  for (const row of rows) {
    const invalidReason = validateRow(row);
    if (invalidReason) {
      out.push({ row, category: "invalid", reason: invalidReason });
      continue;
    }
    const key = `${row.baseCurrency}:${row.quoteCurrency}:${row.date}`;
    if (seenInFile.has(key)) {
      out.push({ row, category: "invalid", reason: "Duplicate row for the same pair and date in this file." });
      continue;
    }
    seenInFile.add(key);

    const active = findActiveFxRate(db, { baseCurrency: row.baseCurrency, quoteCurrency: row.quoteCurrency, requestedDate: row.date });
    if (!active) {
      out.push({ row, category: "insert", reason: null });
    } else if (active.rate === row.rate) {
      out.push({ row, category: "skip", reason: "An identical active rate already exists." });
    } else if (active.source === "manual" && active.isUserOverride && !overrideManual) {
      out.push({ row, category: "skip", reason: "A manual override exists; not replaced without confirmation." });
    } else if (!overrideProvider) {
      out.push({ row, category: "skip", reason: "An active rate exists and override is disabled." });
    } else {
      out.push({ row, category: "replace", reason: null });
    }
  }

  const counts = { insert: 0, replace: 0, skip: 0, invalid: 0 };
  for (const r of out) counts[r.category]++;
  return { rows: out, counts };
}

/** Commit the import as one batch: insert new rows, supersede+replace changed ones. */
export function commitFxImport(
  db: SqliteDatabase,
  filename: string,
  rows: FxCsvRow[],
  options: FxImportOptions = {}
): FxRateImportBatch {
  const preview = previewFxImport(db, rows, options);
  const batch = createFxImportBatch(db, { filename });

  const apply = db.transaction(() => {
    let inserted = 0;
    let replaced = 0;
    for (const { row, category } of preview.rows) {
      const base = { baseCurrency: row.baseCurrency, quoteCurrency: row.quoteCurrency, requestedDate: row.date, effectiveDate: row.date, rate: row.rate, source: "user-upload" as const, importBatchId: batch.id, notes: row.notes };
      if (category === "insert") {
        insertFxRate(db, base);
        inserted++;
      } else if (category === "replace") {
        replaceActiveFxRate(db, base);
        replaced++;
      }
    }
    return { inserted, replaced };
  });

  const { inserted, replaced } = apply();
  const rejected = preview.counts.invalid;
  return (
    updateFxImportBatch(db, batch.id, {
      insertedCount: inserted,
      replacedCount: replaced,
      rejectedCount: rejected,
      status: rejected > 0 ? "completed-with-errors" : "completed",
    }) ?? batch
  );
}
