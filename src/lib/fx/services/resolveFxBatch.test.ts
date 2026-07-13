/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { resolveFxBatch, fxNeedKey } from "./resolveFxBatch";
import { insertFxRate } from "../repositories/fxRateRepository";
import type { FxRateProvider } from "../providers/fxRateProvider";
import type { SqliteDatabase } from "@/lib/app-db/types";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-fxbatch-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

const NOW = Date.parse("2026-07-20T00:00:00Z");

function makeProvider(): FxRateProvider & { seriesCalls: number } {
  const p = {
    name: "stub",
    seriesCalls: 0,
    async getRate({ baseCurrency, quoteCurrency, date }: { baseCurrency: string; quoteCurrency: string; date: string }) {
      return { provider: "stub", baseCurrency, quoteCurrency, requestedDate: date, effectiveDate: date, rate: "0.4", source: "frankfurter" as const, isManual: false, fxRateId: null };
    },
    async getRateSeries({ from, to }: { baseCurrency: string; quoteCurrency: string; from: string; to: string }) {
      p.seriesCalls++;
      // Return a rate for every trading day requested (the batch fill covers the range).
      const out: { date: string; rate: string }[] = [];
      for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
        out.push({ date: d.toISOString().slice(0, 10), rate: "0.4" });
      }
      return out;
    },
  };
  return p;
}
const provider = makeProvider();

describe("resolveFxBatch", () => {
  let root: string;
  let db: SqliteDatabase;
  beforeEach(() => ({ root, db } = tempDb()));
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("dedupes needs and resolves each once, keyed by pair+date", async () => {
    insertFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10", effectiveDate: "2026-07-10", rate: "0.4162", source: "manual" });
    const res = await resolveFxBatch(
      db,
      [
        { baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" },
        { baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" }, // dup
      ],
      { nowMs: NOW }
    );
    expect(Object.keys(res.resolved)).toEqual([fxNeedKey({ baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" })]);
    expect(res.resolved[fxNeedKey({ baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" })].rate).toBe("0.4162");
  });

  it("routes an unresolvable need to pending without failing the batch", async () => {
    insertFxRate(db, { baseCurrency: "AED", quoteCurrency: "AUD", requestedDate: "2026-07-10", effectiveDate: "2026-07-10", rate: "0.4162", source: "manual" });
    const res = await resolveFxBatch(
      db,
      [
        { baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" }, // resolves
        { baseCurrency: "JOD", quoteCurrency: "AUD", date: "2026-07-10" }, // no rate, no provider
        { baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-08-30" }, // future
      ],
      { nowMs: NOW }
    );
    expect(Object.keys(res.resolved)).toHaveLength(1);
    expect(res.pending[fxNeedKey({ baseCurrency: "JOD", quoteCurrency: "AUD", date: "2026-07-10" })].code).toBe("RATE_NOT_FOUND");
    expect(res.pending[fxNeedKey({ baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-08-30" })].code).toBe("FUTURE_DATE");
  });

  it("uses the provider when allowed and persists the fetch", async () => {
    const res = await resolveFxBatch(db, [{ baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" }], { provider, nowMs: NOW });
    expect(res.resolved[fxNeedKey({ baseCurrency: "AED", quoteCurrency: "AUD", date: "2026-07-10" })].rate).toBe("0.4");
  });

  it("fetches the provider once for many dates of the same pair (batched range)", async () => {
    const p = makeProvider();
    const needs = ["2026-07-08", "2026-07-09", "2026-07-10"].map((date) => ({ baseCurrency: "AED", quoteCurrency: "AUD", date }));
    const res = await resolveFxBatch(db, needs, { provider: p, nowMs: NOW });
    expect(Object.keys(res.resolved)).toHaveLength(3);
    expect(p.seriesCalls).toBe(1); // one range fetch, not one per date
  });
});
