import { bookMarkers, buildBuckets, bucketOf, cashflowPoints, valuePoints } from "./timeline";

it("builds the last twelve months ending today, plus projected months, and years since the first record", () => {
  const monthly = buildBuckets("monthly", "2026-10-25", null, 2);
  expect(monthly).toHaveLength(14);
  expect(monthly[0]).toMatchObject({ label: "Nov ’25", from: "2025-11-01", to: "2025-11-30" });
  expect(monthly[11]).toMatchObject({ current: true, to: "2026-10-25", title: "Oct 2026 (to date)" });
  expect(monthly[12]).toMatchObject({ projected: true, label: "Nov ’26" });
  const yearly = buildBuckets("yearly", "2026-10-25", "2024-03-01", 1);
  expect(yearly.map((b) => b.label)).toEqual(["2024", "2025", "2026", "2027"]);
  expect(bucketOf(yearly, "2025-07-01")).toBe(1); expect(bucketOf(yearly, "2020-01-01")).toBe(-1);
});
it("plots value and debt per bucket and a forecast that subtracts unposted months without rebasing", () => {
  const buckets = buildBuckets("monthly", "2026-10-25", null, 2);
  const rows = [{ date: "2026-01-10", runningMinor: 1000000 }, { date: "2026-09-05", runningMinor: 900000 }];
  const points = valuePoints(buckets, rows, 900000, (date) => date >= "2026-09-01" ? 400000 : null, [{ postDate: "2026-10-31", amountMinor: 10000 }, { postDate: "2026-11-30", amountMinor: 10000 }]);
  expect(points[0].value).toBeNull(); // before the first row
  expect(points[11]).toMatchObject({ value: 900000, debt: 400000, forecast: 900000 });
  expect(points[12]).toMatchObject({ value: null, forecast: 880000 }); // Nov: both unposted months (Oct is due, not yet posted)
  expect(points[13].forecast).toBe(880000);
});
it("groups book events per bucket and kind", () => {
  const buckets = buildBuckets("monthly", "2026-10-25", null);
  const markers = bookMarkers(buckets, [
    { date: "2026-03-02", classification: "capital-expenditure", amountMinor: 100 }, { date: "2026-03-20", classification: "acquisition", amountMinor: 50 },
    { date: "2026-03-31", classification: "depreciation", amountMinor: -10 }, { date: "2026-04-30", classification: "depreciation", amountMinor: -10 }, { date: "2026-04-01", classification: "other-adjustment", amountMinor: 1 },
  ]);
  expect(markers.map((m) => [m.kind, m.count, m.amountMinor])).toEqual([["in", 2, 150], ["depreciation", 1, -10], ["depreciation", 1, -10]]);
});
it("keeps capital out of the operating net", () => {
  const buckets = buildBuckets("monthly", "2026-10-25", null);
  const points = cashflowPoints(buckets, [{ date: "2026-05-05", type: "rental-income", amountMinor: 1500 }, { date: "2026-05-14", type: "operating-expense", amountMinor: -350 }, { date: "2026-05-15", type: "rental-income", amountMinor: -1 }],
    [{ date: "2026-05-20", kind: "capex", amountMinor: -20000, rowIds: ["x"] }, { date: "2026-05-21", kind: "disposal", amountMinor: 900, rowIds: ["y"] }]);
  const may = points[buildBuckets("monthly", "2026-10-25", null).findIndex((b) => b.label === "May ’26")];
  expect(may).toMatchObject({ income: 1500, expenses: -350, net: 1150, capex: -20000, disposal: 900, investment: 0 }); // a wrong-signed income row is ignored
});
import { financingEvents, financingMarkers } from "./timeline";
it("explains allocation changes in words and marks them per bucket", () => {
  const events = financingEvents([
    { debtId: "loan", allocationBps: 10000, effectiveFrom: "2026-01-01", effectiveTo: "2026-07-01" }, { debtId: "loan", allocationBps: 6000, effectiveFrom: "2026-07-01", effectiveTo: "2026-10-01" },
  ], () => "Mortgage");
  expect(events.map((e) => e.text)).toEqual(["Mortgage: allocated at 100%", "Mortgage: allocation changed from 100% to 60%", "Mortgage: allocation ended"]);
  const markers = financingMarkers(buildBuckets("monthly", "2026-10-25", null), events);
  expect(markers.map((m) => m.note)).toEqual(["Mortgage: allocated at 100%", "Mortgage: allocation changed from 100% to 60%", "Mortgage: allocation ended"]);
});
