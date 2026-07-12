/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { convertCurrency } from "./convertCurrency";
import { resolveFxRate } from "./resolveFxRate";
import {
  findActiveFxRate,
  insertFxRate,
  replaceActiveFxRate,
} from "../repositories/fxRateRepository";
import { findTransactionFx } from "../repositories/transactionFxRepository";
import { FxError } from "../errors";
import type { FxRateProvider } from "../providers/fxRateProvider";
import type { SqliteDatabase } from "@/lib/app-db/types";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-fx-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

// A provider that hands back a fixed rate and counts calls.
function stubProvider(rate = "0.4162"): FxRateProvider & { calls: number } {
  const p = {
    name: "stub",
    calls: 0,
    async getRate({ baseCurrency, quoteCurrency, date }: { baseCurrency: string; quoteCurrency: string; date: string }) {
      p.calls++;
      return { provider: "stub", baseCurrency, quoteCurrency, requestedDate: date, effectiveDate: date, rate, source: "frankfurter" as const, isManual: false, fxRateId: null };
    },
  };
  return p;
}

const NOW = Date.parse("2026-07-20T00:00:00Z");

describe("FX resolution + conversion", () => {
  let root: string;
  let db: SqliteDatabase;
  beforeEach(() => ({ root, db } = tempDb()));
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("same-currency converts at rate 1 without a provider call", async () => {
    const provider = stubProvider();
    const res = await convertCurrency(db, { amount: 100000, sourceCurrency: "AED", targetCurrency: "AED", date: "2026-07-10" }, { provider, nowMs: NOW });
    expect(res).toMatchObject({ convertedAmount: 100000, rate: "1", rateSource: "derived" });
    expect(provider.calls).toBe(0);
  });

  it("rejects a future-dated transaction", async () => {
    await expect(resolveFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-25" }, { provider: stubProvider(), nowMs: NOW })).rejects.toMatchObject({ code: "FUTURE_DATE" });
  });

  it("fetches from the provider once, then reuses the stored registry rate", async () => {
    const provider = stubProvider("0.4162");
    const a = await convertCurrency(db, { amount: 100000, sourceCurrency: "AED", targetCurrency: "AUD", date: "2026-07-10" }, { provider, nowMs: NOW });
    expect(a.convertedAmount).toBe(41620);
    expect(provider.calls).toBe(1);
    // Second, different transaction, same pair+date → no new provider call.
    const b = await convertCurrency(db, { amount: 50000, sourceCurrency: "AED", targetCurrency: "AUD", date: "2026-07-10" }, { provider, nowMs: NOW });
    expect(b.convertedAmount).toBe(20810);
    expect(provider.calls).toBe(1);
  });

  it("a transaction-specific manual rate wins and does not touch the registry", async () => {
    const provider = stubProvider("0.4162");
    const res = await convertCurrency(db, { amount: 100000, sourceCurrency: "AED", targetCurrency: "AUD", date: "2026-07-10", transactionId: "txn-1", manualRate: "0.5" }, { provider, nowMs: NOW });
    expect(res).toMatchObject({ convertedAmount: 50000, rate: "0.5", rateSource: "manual", isManual: true });
    expect(provider.calls).toBe(0);
    expect(findActiveFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10" })).toBeNull();
  });

  it("reuses an existing transaction snapshot on rerun (lock at first sync)", async () => {
    const provider = stubProvider("0.4162");
    await convertCurrency(db, { amount: 100000, sourceCurrency: "AED", targetCurrency: "AUD", date: "2026-07-10", transactionId: "txn-9" }, { provider, nowMs: NOW });
    expect(findTransactionFx(db, "txn-9")?.appliedRate).toBe("0.4162");
    // Even after the registry rate changes, the rerun keeps the snapshot's rate.
    replaceActiveFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10", effectiveDate: "2026-07-10", rate: "0.99", source: "manual", isUserOverride: true });
    const rerun = await convertCurrency(db, { amount: 100000, sourceCurrency: "AED", targetCurrency: "AUD", date: "2026-07-10", transactionId: "txn-9" }, { provider, nowMs: NOW });
    expect(rerun.rate).toBe("0.4162");
    expect(provider.calls).toBe(1);
  });

  it("derives a direct rate from a stored inverse", async () => {
    insertFxRate(db, { baseCurrency: "AUD", quoteCurrency: "AED", requestedDate: "2026-07-10", effectiveDate: "2026-07-10", rate: "2.5", source: "manual" });
    const res = await resolveFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" }, { nowMs: NOW });
    expect(res).toMatchObject({ rate: "0.4", source: "derived" });
    // The derived rate is persisted for reuse.
    expect(findActiveFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10" })?.source).toBe("derived");
  });

  it("errors when no rate is stored and no provider is available", async () => {
    await expect(resolveFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" }, { nowMs: NOW })).rejects.toMatchObject({ code: "RATE_NOT_FOUND" });
  });

  it("replaceActiveFxRate supersedes the old row and keeps one active", () => {
    insertFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10", effectiveDate: "2026-07-10", rate: "0.4162", source: "frankfurter", provider: "frankfurter" });
    replaceActiveFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10", effectiveDate: "2026-07-10", rate: "0.4180", source: "manual", isUserOverride: true });
    const active = findActiveFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10" });
    expect(active).toMatchObject({ rate: "0.4180", source: "manual", isUserOverride: true });
    // The previous provider row is retained as superseded (audit history).
    const all = db.prepare("SELECT status FROM fx_rates WHERE base_currency='AED' AND quote_currency='AUD'").all<{ status: string }>();
    expect(all.map((r) => r.status).sort()).toEqual(["active", "superseded"]);
  });
});

describe("FxError", () => {
  it("is thrown as a typed error", () => {
    expect(new FxError("RATE_NOT_FOUND", "x")).toBeInstanceOf(Error);
  });
});
