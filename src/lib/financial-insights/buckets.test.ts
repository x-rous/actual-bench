import { balanceBuckets, bucketMonths, defaultGranularity, endsEarly, lastIndex, sumOver } from "./buckets";

const months = (from: string, count: number): string[] => {
  const [y, m] = from.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => { const t = y * 12 + (m - 1) + i; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; });
};
const all = (n: number, v: boolean) => Array.from({ length: n }, () => v);

describe("spending buckets", () => {
  it("leaves months alone, flagging only a month still running", () => {
    const m = months("2026-09", 3);
    const b = bucketMonths(m, all(3, true), [false, false, true], "month");
    expect(b.map((x) => [x.label, x.partial])).toEqual([["Sep 2026", false], ["Oct 2026", false], ["Nov 2026", true]]);
  });

  it("groups whole calendar quarters, and flags the ones the period only partly covers", () => {
    const m = months("2024-11", 24); // Nov 2024 .. Oct 2026
    const b = bucketMonths(m, all(24, true), all(24, false), "quarter");
    expect(b.map((x) => x.label)).toEqual(["Q4 2024", "Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025", "Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"]);
    expect(b.map((x) => x.partial)).toEqual([true, false, false, false, false, false, false, false, true]);
    expect([b[0].first, b[0].last, b[1].first, b[1].last]).toEqual(["2024-11", "2024-12", "2025-01", "2025-03"]);
  });

  it("groups calendar years, flagging the first and last when partial", () => {
    const m = months("2025-01", 23); // Jan 2025 .. Nov 2026
    const b = bucketMonths(m, all(23, true), [...all(22, false), true], "year");
    expect(b.map((x) => [x.label, x.partial])).toEqual([["2025", false], ["2026", true]]);
  });

  it("calls a unit partial when one of its months has no data yet, and sums only months with data", () => {
    const m = months("2026-01", 6);
    const has = [false, false, true, true, true, true];
    const b = bucketMonths(m, has, all(6, false), "quarter");
    expect(b.map((x) => [x.label, x.partial, x.hasData])).toEqual([["Q1 2026", true, true], ["Q2 2026", false, true]]);
    expect(sumOver([5, 5, 10, 20, 30, 40], b[0], has)).toBe(10);
    expect(sumOver([5, 5, 10, 20, 30, 40], b[1], has)).toBe(90);
  });

  it("has no data in a bucket made only of months before the budget starts", () => {
    const b = bucketMonths(months("2025-10", 3), all(3, false), all(3, false), "quarter");
    expect(b.map((x) => [x.hasData, x.partial])).toEqual([[false, true]]);
  });
});

describe("balance buckets", () => {
  it("opens in months for a short period, quarters for a few years and years beyond", () => {
    expect([1, 12, 18].map(defaultGranularity)).toEqual(["month", "month", "month"]);
    expect([19, 24, 60].map(defaultGranularity)).toEqual(["quarter", "quarter", "quarter"]);
    expect([61, 95].map(defaultGranularity)).toEqual(["year", "year"]);
  });

  it("stands a quarter or year for by its last month, and says when the period ends before the quarter or year does", () => {
    const m = months("2025-11", 12); // Nov 2025 .. Oct 2026
    const q = balanceBuckets(m, "quarter");
    expect(q.map((b) => [b.label, m[lastIndex(b)], endsEarly(b, "quarter")])).toEqual([["Q4 2025", "2025-12", false], ["Q1 2026", "2026-03", false], ["Q2 2026", "2026-06", false], ["Q3 2026", "2026-09", false], ["Q4 2026", "2026-10", true]]);
    const y = balanceBuckets(m, "year");
    expect(y.map((b) => [b.label, m[lastIndex(b)], endsEarly(b, "year")])).toEqual([["2025", "2025-12", false], ["2026", "2026-10", true]]);
    expect(balanceBuckets(m, "month").some((b) => endsEarly(b, "month"))).toBe(false);
  });
});
