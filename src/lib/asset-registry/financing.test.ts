import { allocatedDebtMinor, allocationAt, changePair, checkLoanLimits, loanShares, trackedEquity, type AssetDebtLink } from "./financing";

const link = (from: string, to: string | null, bps: number, assetId = "house", debtId = "loan"): AssetDebtLink => ({ assetId, debtId, allocationBps: bps, effectiveFrom: from, effectiveTo: to, note: null });
const set = (rows: AssetDebtLink[], from: string, bps: number, extra: object = {}) => changePair(rows, { kind: "set", assetId: "house", debtId: "loan", effectiveFrom: from, allocationBps: bps, ...extra });
it("keeps June at 100% and starts 60% in July, preserving history across end and reopen", () => {
  const changed = set([link("2026-01-01", null, 10000)], "2026-07-01", 6000);
  expect(changed).toEqual([link("2026-01-01", "2026-07-01", 10000), link("2026-07-01", null, 6000)]);
  expect(allocationAt(changed, "house", "loan", "2026-06-30")?.allocationBps).toBe(10000);
  expect(allocationAt(changed, "house", "loan", "2026-07-01")?.allocationBps).toBe(6000);
  const ended = changePair(changed, { kind: "end", assetId: "house", debtId: "loan", effectiveFrom: "2026-10-01" });
  expect(ended.at(-1)).toMatchObject({ effectiveFrom: "2026-07-01", effectiveTo: "2026-10-01" });
  const reopened = set(ended, "2027-01-01", 5000);
  expect(reopened.map((r) => [r.effectiveFrom, r.effectiveTo, r.allocationBps])).toEqual([["2026-01-01", "2026-07-01", 10000], ["2026-07-01", "2026-10-01", 6000], ["2027-01-01", null, 5000]]);
  expect(allocationAt(reopened, "house", "loan", "2026-11-15")).toBeNull();
});
it("a change before a later saved period closes only the containing period and keeps the later one", () => {
  const rows = [link("2026-01-01", "2026-04-01", 10000), link("2026-09-01", null, 4000)];
  const inserted = set(rows, "2026-02-01", 7000);
  expect(inserted.map((r) => [r.effectiveFrom, r.effectiveTo, r.allocationBps])).toEqual([["2026-01-01", "2026-02-01", 10000], ["2026-02-01", "2026-04-01", 7000], ["2026-09-01", null, 4000]]);
  // starting in a gap runs to the next saved start
  expect(set(rows, "2026-05-01", 2000).find((r) => r.effectiveFrom === "2026-05-01")?.effectiveTo).toBe("2026-09-01");
  // an explicit same-start correction edits that period in place
  expect(set(rows, "2026-09-01", 3000).at(-1)).toMatchObject({ effectiveFrom: "2026-09-01", allocationBps: 3000 });
});
it("refuses overlap and any allocation above 100% at every boundary, including archived and future periods", () => {
  expect(checkLoanLimits([link("2026-01-01", "2026-07-01", 6000), link("2026-07-01", null, 6000)])).toBeNull();
  expect(checkLoanLimits([link("2026-01-01", null, 6000), link("2026-03-01", null, 6000, "boat")])).toMatch(/exceed 100%/);
  // a future period of another (e.g. archived) asset still reserves its share
  expect(checkLoanLimits([link("2026-01-01", null, 5000), link("2027-01-01", null, 6000, "boat")])).toMatch(/2027-01-01/);
  expect(checkLoanLimits([link("2026-01-01", "2026-08-01", 5000), link("2026-07-01", null, 1000)])).toMatch(/cannot overlap/);
  expect(checkLoanLimits([link("2026-01-01", "2026-07-01", 5000), link("2026-07-01", null, 5000, "boat")])).toBeNull(); // an end frees the share at the boundary
  expect(loanShares([link("2026-01-01", null, 6000)], "loan", "2026-02-01").unallocatedBps).toBe(4000);
});
it("computes dated equity from same-date Actual evidence and never substitutes missing data", () => {
  const links = [link("2026-01-01", "2026-07-01", 10000), link("2026-07-01", null, 6000)];
  const debts = (june: number | null, july: number | null) => ({ june: [{ debtId: "loan", magnitudeMinor: june }], july: [{ debtId: "loan", magnitudeMinor: july }] });
  const d = debts(100000, 80000);
  expect(trackedEquity("house", "2026-06-30", links, 500000, d.june)).toMatchObject({ allocatedDebtMinor: 100000, equityMinor: 400000, gaps: [] });
  expect(trackedEquity("house", "2026-07-31", links, 500000, d.july)).toMatchObject({ allocatedDebtMinor: 48000, equityMinor: 452000 });
  expect(trackedEquity("house", "2026-07-31", links, 500000, debts(100000, null).july)).toMatchObject({ allocatedDebtMinor: null, equityMinor: null });
  expect(trackedEquity("house", "2026-07-31", links, null, d.july).equityMinor).toBeNull();
  expect(trackedEquity("house", "2025-12-31", links, 500000, []).equityMinor).toBe(500000); // before the first link no financing is known
  expect(allocatedDebtMinor(1, 5000)).toBe(0); expect(allocatedDebtMinor(3, 5000)).toBe(2); // half-even, once
});
