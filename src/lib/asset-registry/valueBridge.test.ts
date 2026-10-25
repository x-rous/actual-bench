import { valueBridge } from "./valueBridge";

const rows = [
  { date: "2025-01-10", classification: "opening-balance", amountMinor: 1000000 }, { date: "2025-06-01", classification: "revaluation", amountMinor: 200000 },
  { date: "2026-02-01", classification: "capital-expenditure", amountMinor: 50000 }, { date: "2026-03-31", classification: "depreciation", amountMinor: -30000 },
  { date: "2026-04-30", classification: "impairment", amountMinor: -20000 }, { date: "2026-05-01", classification: "revaluation", amountMinor: -10000 },
  { date: "2026-06-01", classification: "disposal", amountMinor: -100000 }, { date: "2026-07-01", classification: null, amountMinor: 5 }, { date: "2026-12-01", classification: "revaluation", amountMinor: 999 },
];
it("sums classified rows into a bridge that adds up to the closing value", () => {
  expect(valueBridge(rows, "2026-01-01", "2026-10-24")).toEqual({ openingMinor: 1200000, capitalMinor: 50000, revaluationMinor: -10000, depreciationMinor: -50000, disposalMinor: -100000, otherMinor: 5, closingMinor: 1090005 });
});
it("over the whole life starts from nothing, and the closing equals every row to date", () => {
  const life = valueBridge(rows, null, "2026-10-24");
  expect(life).toMatchObject({ openingMinor: 0, capitalMinor: 1050000, revaluationMinor: 190000, closingMinor: 1090005 });
  expect(life.closingMinor).toBe(rows.filter((r) => r.date <= "2026-10-24").reduce((s, r) => s + r.amountMinor, 0));
});
