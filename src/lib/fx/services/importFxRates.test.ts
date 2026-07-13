/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { parseFxCsv, previewFxImport, commitFxImport } from "./importFxRates";
import { findActiveFxRate, insertFxRate } from "../repositories/fxRateRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-fximport-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

const CSV = `date,base_currency,quote_currency,rate
2026-07-10,AED,AUD,0.4180
2026-07-11,aed,aud,0.4175
2026-07-10,AED,AUD,0.9999
2026-13-40,AED,AUD,0.4
2026-07-12,AED,AED,0.4
2026-07-12,AED,AUD,-1`;

describe("parseFxCsv", () => {
  it("skips the header, upper-cases codes, and keeps a line number", () => {
    const rows = parseFxCsv(CSV);
    expect(rows[0]).toMatchObject({ line: 2, date: "2026-07-10", baseCurrency: "AED", quoteCurrency: "AUD", rate: "0.4180" });
    expect(rows[1].baseCurrency).toBe("AED");
  });
});

describe("previewFxImport", () => {
  let root: string;
  let db: SqliteDatabase;
  beforeEach(() => ({ root, db } = tempDb()));
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("categorizes insert / replace / skip / invalid", () => {
    insertFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10", effectiveDate: "2026-07-10", rate: "0.4000", source: "frankfurter", provider: "frankfurter" });
    const preview = previewFxImport(db, parseFxCsv(CSV));
    // 2026-07-10 differs from the active provider rate → replace.
    expect(preview.rows.find((r) => r.row.line === 2)?.category).toBe("replace");
    // 2026-07-11 has no active rate → insert.
    expect(preview.rows.find((r) => r.row.line === 3)?.category).toBe("insert");
    // second 2026-07-10 is an in-file duplicate → invalid.
    expect(preview.rows.find((r) => r.row.line === 4)?.category).toBe("invalid");
    // bad date, same-currency, negative rate → invalid.
    expect(preview.counts.invalid).toBe(4);
  });

  it("protects an active manual override unless override is confirmed", () => {
    insertFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10", effectiveDate: "2026-07-10", rate: "0.5", source: "manual", isUserOverride: true });
    const rows = parseFxCsv("date,base_currency,quote_currency,rate\n2026-07-10,AED,AUD,0.4180");
    expect(previewFxImport(db, rows).rows[0].category).toBe("skip");
    expect(previewFxImport(db, rows, { overrideManual: true }).rows[0].category).toBe("replace");
  });
});

describe("commitFxImport", () => {
  let root: string;
  let db: SqliteDatabase;
  beforeEach(() => ({ root, db } = tempDb()));
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("inserts valid rows, supersedes replaced ones, and reports batch counts", () => {
    insertFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10", effectiveDate: "2026-07-10", rate: "0.4000", source: "frankfurter", provider: "frankfurter" });
    const batch = commitFxImport(db, "rates.csv", parseFxCsv(CSV));
    expect(batch).toMatchObject({ insertedCount: 1, replacedCount: 1, rejectedCount: 4, status: "completed-with-errors" });
    // The replaced pair+date now has the uploaded rate active.
    expect(findActiveFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10" })).toMatchObject({ rate: "0.4180", source: "user-upload" });
  });
});
