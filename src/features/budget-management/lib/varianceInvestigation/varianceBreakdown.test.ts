import { buildCategoryBreakdown, buildMonthBreakdown } from "./varianceBreakdown";
import { buildVarianceModel } from "./varianceViewModel";
import { statesFor, type CategorySpec } from "./testing";

const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
const exp = (id: string, budget: number, spent: number, extra: Partial<CategorySpec> = {}): CategorySpec => ({
  id,
  budgeted: -budget,
  actuals: -spent,
  ...extra,
});

const tracking = (perMonth: (i: number) => CategorySpec[]) =>
  buildVarianceModel({
    mode: "tracking",
    side: "expense",
    months,
    level: "category",
    statesByMonth: statesFor(Object.fromEntries(months.map((m, i) => [m, perMonth(i)]))),
  });

describe("category breakdown", () => {
  const model = tracking((i) => [
    exp("over", 1000, 1500),
    exp("fine", 1000, 900, { group: "g2" }),
    exp("surprise", 0, [0, 0, 0, 300][i], { group: "g3" }),
    exp("idle", 0, 0, { group: "g4" }),
  ]);
  const rows = buildCategoryBreakdown(model, ["over", "fine", "surprise", "idle"], months);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

  it("drops a category with nothing in it", () => {
    expect(byKey.idle).toBeUndefined();
  });

  it("flags overspending in most months as a repeat", () => {
    expect(byKey.over.signals).toEqual(["repeated"]);
    expect(byKey.fine.signals).toEqual([]);
  });

  it("flags spending against a zero budget as unbudgeted", () => {
    expect(byKey.surprise.signals).toEqual(["unbudgeted"]);
  });

  it("flags a refund-heavy category as a net refund", () => {
    const refund = tracking(() => [{ id: "back", budgeted: -500, actuals: 800 }]);
    expect(buildCategoryBreakdown(refund, ["back"], months)[0].signals).toEqual(["net-refund"]);
  });

  it("sums only the months it is given", () => {
    const first = buildCategoryBreakdown(model, ["over"], ["2026-01"])[0];
    expect(first.aggregate.actual).toBe(1500);
    expect(first.signals).toEqual([]);
  });
});

describe("month breakdown", () => {
  const model = tracking((i) => [exp("a", 1000, [1500, 900, 1800, 1000][i])]);

  it("marks the month with the largest overspend", () => {
    const rows = buildMonthBreakdown(model, ["a"], months);
    expect(rows.map((r) => r.aggregate.variance)).toEqual([500, -100, 800, 0]);
    expect(rows.find((r) => r.signals.includes("largest-month"))?.month).toBe("2026-03");
  });

  it("does not mark a largest month when there is only one", () => {
    expect(buildMonthBreakdown(model, ["a"], ["2026-01"])[0].signals).toEqual([]);
  });
});

describe("Envelope breakdown", () => {
  const env = buildVarianceModel({
    mode: "envelope",
    side: "expense",
    months: ["2026-08"],
    level: "category",
    statesByMonth: statesFor({
      "2026-08": [
        { id: "deficit", budgeted: 100, actuals: -150, balance: -50, carryover: true },
        { id: "covered", group: "g2", budgeted: 100, actuals: -150, balance: 200 },
      ],
    }),
  });
  const rows = buildCategoryBreakdown(env, ["deficit", "covered"], ["2026-08"]);

  it("separates a deficit from an overspend covered by carried-in money", () => {
    expect(rows.find((r) => r.key === "deficit")!.signals).toEqual(["deficit", "carryover"]);
    expect(rows.find((r) => r.key === "covered")!.signals).toEqual(["covered"]);
  });
});
