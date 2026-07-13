/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { fillFxRateRange } from "./fillFxRateRange";
import { findActiveFxRate, insertFxRate } from "../repositories/fxRateRepository";
import type { FxRateProvider } from "../providers/fxRateProvider";
import type { SqliteDatabase } from "@/lib/app-db/types";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-fxfill-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

const provider: FxRateProvider = {
  name: "stub",
  async getRate() { throw new Error("unused"); },
  async getRateSeries() {
    return [
      { date: "2026-07-08", rate: "0.393" },
      { date: "2026-07-09", rate: "0.3931" },
      { date: "2026-07-10", rate: "0.3924" },
    ];
  },
};

describe("fillFxRateRange", () => {
  let root: string;
  let db: SqliteDatabase;
  beforeEach(() => ({ root, db } = tempDb()));
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("inserts each provider day and skips dates that already have an active rate", async () => {
    // A manual override already exists for one date — must be preserved, not overwritten.
    insertFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-09", effectiveDate: "2026-07-09", rate: "0.5", source: "manual", isUserOverride: true });

    const result = await fillFxRateRange(db, { baseCurrency: "AED", quoteCurrency: "AUD", from: "2026-07-08", to: "2026-07-10" }, provider);
    expect(result).toEqual({ fetched: 3, inserted: 2, skipped: 1 });

    expect(findActiveFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10" })?.rate).toBe("0.3924");
    // The manual override is untouched.
    expect(findActiveFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-09" })).toMatchObject({ rate: "0.5", source: "manual" });
  });
});
