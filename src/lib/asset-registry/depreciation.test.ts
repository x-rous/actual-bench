import { depreciationSchedule, forecastMonths, monthEnd, periodStatuses, depreciationInputSchema } from "./depreciation";

const straight = { method: "straight-line" as const, basisMinor: 100001, residualMinor: 1001, startDate: "2027-01-15", lifeMonths: 7, annualRateBps: null };
const declining = { method: "declining-balance" as const, basisMinor: 100000, residualMinor: 90000, startDate: "2026-01-01", lifeMonths: null, annualRateBps: 2000 };
it("straight-line cumulative rounding reaches the residual exactly and never overshoots", () => {
  const rows = depreciationSchedule(straight, 12);
  expect(rows.slice(0, 7).reduce((s, r) => s + r.amountMinor, 0)).toBe(100001 - 1001);
  expect(rows[6].closingMinor).toBe(1001);
  expect(rows.slice(7).every((r) => r.amountMinor === 0 && r.closingMinor === 1001)).toBe(true);
  expect(rows.every((r) => Number.isInteger(r.amountMinor) && r.amountMinor >= 0)).toBe(true);
});
it("declining balance is bounded by the residual and the forecast has no side effects", () => {
  const frozen = Object.freeze({ ...declining });
  const rows = depreciationSchedule(frozen, 120);
  expect(rows[0].amountMinor).toBe(1667); // 100000 × 20% ÷ 12, half-even
  expect(Math.min(...rows.map((r) => r.closingMinor))).toBe(90000);
  expect(rows.at(-1)!.amountMinor).toBe(0);
});
it("dates each month at its own calendar end including leap years", () => {
  expect(monthEnd("2028-02")).toBe("2028-02-29"); expect(monthEnd("2027-02")).toBe("2027-02-28"); expect(monthEnd("2026-04")).toBe("2026-04-30");
  expect(depreciationSchedule({ ...straight, startDate: "2027-12-01" }, 3).map((r) => r.postDate)).toEqual(["2027-12-31", "2028-01-31", "2028-02-29"]);
});
it("marks months due only after their end date and keeps posted/missing identity across settings edits", () => {
  const rows = depreciationSchedule({ ...straight, startDate: "2026-01-01" }, 4);
  const meta = (assetId: string, period: string, id: string) => ({ actualTransactionId: id, actualAccountId: "a", assetId, classification: "depreciation", revision: 1, depreciationPeriod: period });
  const edited = depreciationSchedule({ ...straight, startDate: "2026-01-01", basisMinor: 500000, lifeMonths: 24 }, 4); // a prospective edit
  const states = (r: typeof rows) => periodStatuses(r, [meta("x", "2026-01", "row-jan"), meta("x", "2026-02", "gone"), meta("other", "2026-03", "other-row")], "x", new Set(["row-jan"]), "2026-03-15").map((p) => p.state);
  expect(states(rows)).toEqual(["posted", "missing", "forecast", "forecast"]);
  expect(states(edited)).toEqual(states(rows));
});
it("validates method parameter shape and residual", () => {
  expect(depreciationInputSchema.safeParse({ ...straight, annualRateBps: 1000 }).success).toBe(false);
  expect(depreciationInputSchema.safeParse({ ...declining, lifeMonths: 12 }).success).toBe(false);
  expect(depreciationInputSchema.safeParse({ ...straight, residualMinor: straight.basisMinor + 1 }).success).toBe(false);
  expect(depreciationInputSchema.safeParse(straight).success).toBe(true);
  expect(forecastMonths({ method: "straight-line", startDate: "2026-01-01", lifeMonths: 60 }, "2026-10-24")).toBe(22);
});
