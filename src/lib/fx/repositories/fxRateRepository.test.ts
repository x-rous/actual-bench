/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { insertFxRate, listFxPairsWithRates, supersedeActiveFxRate } from "./fxRateRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-fx-pairs-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

function rate(db: SqliteDatabase, base: string, quote: string, date: string, value = "1.1000") {
  insertFxRate(db, {
    baseCurrency: base,
    quoteCurrency: quote,
    requestedDate: date,
    effectiveDate: date,
    rate: value,
    source: "manual",
    provider: null,
    notes: null,
  });
}

describe("listFxPairsWithRates", () => {
  let root: string;
  let db: SqliteDatabase;

  beforeEach(() => {
    ({ root, db } = tempDb());
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("finds a pair that only exists because someone saved a rate for it", () => {
    // The case this exists for: a pair added on the page before any flow
    // converts through it. It used to live in the page's own state, so a reload
    // lost it and its rates became unreachable.
    rate(db, "EUR", "USD", "2026-08-29");

    expect(listFxPairsWithRates(db)).toEqual([{ base: "EUR", quote: "USD" }]);
  });

  it("lists each pair once however many rates it holds", () => {
    rate(db, "EUR", "USD", "2026-08-27");
    rate(db, "EUR", "USD", "2026-08-28");
    rate(db, "GBP", "USD", "2026-08-28");

    expect(listFxPairsWithRates(db)).toEqual([
      { base: "EUR", quote: "USD" },
      { base: "GBP", quote: "USD" },
    ]);
  });

  it("does not resurrect a pair whose rates have all been superseded", () => {
    rate(db, "EUR", "USD", "2026-08-29");
    supersedeActiveFxRate(db, {
      baseCurrency: "EUR",
      quoteCurrency: "USD",
      requestedDate: "2026-08-29",
    });

    expect(listFxPairsWithRates(db)).toEqual([]);
  });

  it("returns nothing on a registry that has never held a rate", () => {
    expect(listFxPairsWithRates(db)).toEqual([]);
  });
});
