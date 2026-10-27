import { cashflowByPeriod } from "./cashflowSummary";

const columns = [{ key: "year", from: "2026-01-01", to: "2026-10-24" }, { key: "last", from: "2025-01-01", to: "2025-12-31" }, { key: "all", from: "2019-01-01", to: "2026-10-24" }];
it("groups linked cashflows by category for the same periods as the performance breakdown, with operating result excluding capital", () => {
  const summary = cashflowByPeriod([
    { date: "2025-05-05", category: "Rent", amountMinor: 150000, income: true }, { date: "2026-05-05", category: "Rent", amountMinor: 160000, income: true },
    { date: "2026-03-20", category: "Repairs", amountMinor: -20000, income: false }, { date: "2019-01-01", category: "Other", amountMinor: 5, income: true },
  ], [{ date: "2026-03-01", kind: "investment", amountMinor: -2000000, rowIds: ["roof"] }, { date: "2026-06-01", kind: "disposal", amountMinor: 900000, rowIds: ["sale"] }], columns);
  expect(summary.groups.map((g) => g.label)).toEqual(["Income", "Expenses", "Capital & disposal"]);
  expect(summary.groups[0].values).toEqual([160000, 150000, 310005]);
  expect(summary.operating).toEqual([140000, 150000, 290005]); // the whole-history column is the sum of everything linked
  const capital = summary.groups[2]; expect(capital.rows.map((r) => r.label)).toEqual(["Purchases and payments", "Disposal proceeds, net of selling costs"]);
  expect(capital.values).toEqual([-1100000, 0, -1100000]); // capital never enters the operating result
});
it("nets a refund into its income category instead of listing it as an expense", () => {
  const summary = cashflowByPeriod([{ date: "2026-01-05", category: "Rent", amountMinor: 100000, income: true }, { date: "2026-02-05", category: "Rent", amountMinor: -20000, income: true }], [], [columns[0]]);
  expect(summary.groups.map((g) => g.label)).toEqual(["Income"]); expect(summary.groups[0].values).toEqual([80000]);
});
