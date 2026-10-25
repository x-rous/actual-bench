import { cashflowByYear } from "./cashflowSummary";

it("groups linked cashflows by type and year over five years, with operating result excluding capital", () => {
  const summary = cashflowByYear([
    { date: "2025-05-05", type: "rental-income", amountMinor: 150000 }, { date: "2026-05-05", type: "rental-income", amountMinor: 160000 },
    { date: "2026-03-20", type: "operating-expense", amountMinor: -20000 }, { date: "2019-01-01", type: "other-income", amountMinor: 5 }, // outside the five years
  ], [{ date: "2026-03-01", kind: "capex", amountMinor: -2000000, rowIds: ["roof"] }, { date: "2026-06-01", kind: "disposal", amountMinor: 900000, rowIds: ["sale"] }], 2026);
  expect(summary.years).toEqual([2022, 2023, 2024, 2025, 2026]);
  expect(summary.groups.map((g) => g.label)).toEqual(["Income", "Expenses", "Capital & disposal"]);
  expect(summary.groups[0].byYear).toEqual([0, 0, 0, 150000, 160000]);
  expect(summary.operating).toEqual([0, 0, 0, 150000, 140000]); expect(summary.operatingTotal).toBe(290000);
  const capital = summary.groups[2]; expect(capital.rows.map((r) => r.label)).toEqual(["Capital expenditure", "Disposal proceeds, net of selling costs"]);
  expect(capital.total).toBe(-1100000); // capital never enters the operating result
});
