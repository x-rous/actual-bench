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

const provider: FxRateProvider = {
  name: "stub",
  async getRate({ baseCurrency, quoteCurrency, date }) {
    return { provider: "stub", baseCurrency, quoteCurrency, requestedDate: date, effectiveDate: date, rate: "0.4", source: "frankfurter", isManual: false, fxRateId: null };
  },
};

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
});
