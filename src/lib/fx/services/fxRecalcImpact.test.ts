/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { previewFxRecalcImpact } from "./fxRecalcImpact";
import { insertFxRate, replaceActiveFxRate } from "../repositories/fxRateRepository";
import { saveTransactionFx } from "../repositories/transactionFxRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-fxrecalc-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

function snapshot(db: SqliteDatabase, transactionId: string, sourceAmount: number, convertedAmount: number, appliedRate: string) {
  saveTransactionFx(db, { transactionId, fxRateId: null, sourceCurrency: "AED", targetCurrency: "AUD", sourceAmount, convertedAmount, appliedRate, requestedDate: "2026-07-10", effectiveDate: "2026-07-10", source: "frankfurter", provider: "frankfurter", isManual: false });
}

describe("previewFxRecalcImpact", () => {
  let root: string;
  let db: SqliteDatabase;
  beforeEach(() => ({ root, db } = tempDb()));
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("lists only transactions whose amount would change under the new active rate", () => {
    insertFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10", effectiveDate: "2026-07-10", rate: "0.40", source: "frankfurter", provider: "frankfurter" });
    // Two synced at the old provider rate, one already at the current rate.
    snapshot(db, "t-changes", -100000, -40000, "0.40");
    snapshot(db, "t-neg", -50000, -20000, "0.40");
    snapshot(db, "t-same", -100000, -41800, "0.418");

    // The user overrides the rate to 0.418.
    replaceActiveFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10", effectiveDate: "2026-07-10", rate: "0.418", source: "manual", isUserOverride: true });

    const impact = previewFxRecalcImpact(db, { baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" });
    expect(impact.activeRate).toBe("0.418");
    // t-same already matches the active rate → excluded.
    expect(impact.rows.map((r) => r.transactionId).sort()).toEqual(["t-changes", "t-neg"]);
    const changed = impact.rows.find((r) => r.transactionId === "t-changes")!;
    // 100000 × 0.418 = 41800, sign preserved from the existing (negative) amount.
    expect(changed).toMatchObject({ oldConvertedAmount: -40000, newConvertedAmount: -41800 });
  });

  it("returns nothing when there is no active rate for the pair+date", () => {
    expect(previewFxRecalcImpact(db, { baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" })).toEqual({ activeRate: null, rows: [] });
  });
});
