import { chooseHistoryMonths } from "./varianceBaseline";
import { barLength, barsAxis, MIN_BAR_PX, niceTicks, waterfallAxis, wrapLabel } from "./varianceChartScale";
import { createVarianceFormat } from "./varianceFormat";
import { applyIncomeBudgetFallback } from "./varianceIncomeBudgets";
import { scopeFromKeys, scopeFromTarget, spendingAnalysisTarget } from "./varianceScope";
import { buildVarianceModel } from "./varianceViewModel";
import { buildWaterfall } from "./varianceWaterfall";
import { makeState, statesFor } from "./testing";
import type { BudgetTransactionCategoryOption } from "../budgetTransactionBrowser";

describe("number format", () => {
  it("rounds to whole numbers by default", () => {
    const f = createVarianceFormat(false);
    expect(f.money(7461949)).toBe("74,619");
    expect(f.money(-1234567)).toBe("12,346");
    expect(f.signed(443649)).toBe("+4,436");
    expect(f.signed(-54300)).toBe("−543");
  });

  it("shows cents when the decimals setting is on", () => {
    const f = createVarianceFormat(true);
    expect(f.money(7461949)).toBe("74,619.49");
    expect(f.signed(-54350)).toBe("−543.50");
  });

  it("gives no sign to an amount that rounds to zero", () => {
    expect(createVarianceFormat(false).signed(40)).toBe("0");
    expect(createVarianceFormat(false).signed(-40)).toBe("0");
  });

  it("knows when an amount prints as zero", () => {
    expect(createVarianceFormat(false).isZero(40)).toBe(true);
    expect(createVarianceFormat(false).isZero(60)).toBe(false);
    expect(createVarianceFormat(true).isZero(40)).toBe(false);
    expect(createVarianceFormat(true).isZero(0.2)).toBe(true);
  });

  it("keeps chart labels and axes whole when the decimals setting is on", () => {
    const f = createVarianceFormat(true);
    expect(f.compact(324050)).toBe("3,241");
    expect(f.compactSigned(-324050)).toBe("−3,241");
    expect(f.axis(1000050)).toBe("10,001");
    expect(f.money(324050)).toBe("3,240.50");
  });

  it("shortens large chart labels and keeps small ones whole", () => {
    const f = createVarianceFormat(false);
    expect(f.compact(1260000)).toBe("12.6k");
    expect(f.compact(15000000)).toBe("150k");
    expect(f.compact(324000)).toBe("3,240");
    expect(f.compactSigned(-1260000)).toBe("−12.6k");
  });
});

describe("chart scales", () => {
  it("rounds ticks up to a clean step", () => {
    expect(niceTicks(87, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(0, 4)).toEqual([0, 1]);
  });

  const waterfallOf = (budgetSpec: number[], actualSpec: number[]) => {
    const states = statesFor({
      "2026-08": budgetSpec.map((b, i) => ({
        id: `c${i}`,
        group: `g${i}`,
        budgeted: -b,
        actuals: -actualSpec[i],
      })),
    });
    return buildWaterfall(
      buildVarianceModel({ mode: "tracking", side: "expense", months: ["2026-08"], statesByMonth: states })
    );
  };

  it("cuts the axis when the drivers are small next to the totals", () => {
    const w = waterfallOf([60000, 8000, 5000], [62000, 8600, 4500]);
    const axis = waterfallAxis(w.segments);
    expect(axis.truncated).toBe(true);
    expect(axis.min).toBeGreaterThan(0);
    expect(axis.min).toBeLessThan(Math.min(...w.segments.map((s) => s.to)));
    expect(axis.max).toBeGreaterThanOrEqual(Math.max(...w.segments.map((s) => s.to)));
  });

  it("keeps a zero baseline when the drivers are large", () => {
    const w = waterfallOf([1000, 1000], [3000, 200]);
    const axis = waterfallAxis(w.segments);
    expect(axis.truncated).toBe(false);
    expect(axis.min).toBe(0);
  });

  it("uses one step above and below the zero line, and never collapses the lesser side", () => {
    const axis = barsAxis(8000, 100);
    const step = axis.up[0];
    expect(axis.down[0]).toBe(step);
    expect(axis.upMax).toBeGreaterThanOrEqual(8000);
    expect(axis.downMax).toBeGreaterThanOrEqual(8000 * 0.18);
  });

  it("draws a tiny value at the minimum visible length", () => {
    expect(barLength(100, 5)).toBe(MIN_BAR_PX);
    expect(barLength(1, 50)).toBe(50);
    expect(barLength(1, 0)).toBe(0);
  });

  it("wraps labels onto two lines and ends a cut label with an ellipsis", () => {
    expect(wrapLabel("Vacations & Travel", 12)).toEqual(["Vacations &", "Travel"]);
    expect(wrapLabel("Transportation", 8)).toEqual(["Transpo…"]);
    expect(wrapLabel("Education Childcare Support Extras", 10).at(-1)?.endsWith("…")).toBe(true);
  });
});

describe("scope", () => {
  const option = (entity: "group" | "category", id: string, categoryIds: string[]): BudgetTransactionCategoryOption => ({
    id,
    entity,
    side: "expense",
    title: id,
    subtitle: "",
    categoryIds,
  });
  const options = [option("group", "__all_expenses__", ["a", "b"]), option("group", "g1", ["a"]), option("category", "b", ["b"])];
  const target = (id: string, entity: "group" | "category", categoryIds: string[]) => ({
    id,
    entity,
    side: "expense" as const,
    title: "t",
    monthStart: "2026-01",
    monthEnd: "2026-08",
    categoryIds,
  });

  it("treats a whole-side target as every category on the side", () => {
    expect(scopeFromTarget(target("__period_expenses__", "group", ["a"])).wholeSide).toBe(true);
    expect(scopeFromTarget(target("__month_income__", "group", ["a"])).wholeSide).toBe(true);
  });

  it("scopes a group target by its group, so hidden members count in Envelope", () => {
    expect(scopeFromTarget(target("g1", "group", ["a"]))).toEqual({ wholeSide: false, categoryIds: ["a"], groupIds: ["g1"] });
    expect(scopeFromTarget(target("b", "category", ["b"]))).toEqual({ wholeSide: false, categoryIds: ["b"], groupIds: [] });
  });

  it("builds a scope from picker keys, and a whole-side key wins", () => {
    expect(scopeFromKeys(["group:g1", "category:b"], options)).toEqual({ wholeSide: false, categoryIds: ["b"], groupIds: ["g1"] });
    expect(scopeFromKeys(["group:__all_expenses__", "category:b"], options)?.wholeSide).toBe(true);
    expect(scopeFromKeys(["category:nope"], options)).toBeNull();
  });

  it("builds a Spending Analysis target from the drivers on screen", () => {
    const t = spendingAnalysisTarget({ side: "expense", title: "Vacations", categoryIds: ["b", "a"], monthStart: "2026-08", monthEnd: "2026-08" });
    expect(t).toMatchObject({ entity: "group", categoryIds: ["b", "a"], monthStart: "2026-08" });
    expect(t.id).toBe("variance:a|b");
    expect(spendingAnalysisTarget({ side: "income", title: "x", categoryIds: ["a"], monthStart: "m", monthEnd: "m" }).entity).toBe("category");
  });
});

describe("group scope in the view model", () => {
  const specs = [
    { id: "shown", group: "g1", budgeted: 1000, actuals: -1200, balance: -200 },
    { id: "old", group: "g1", hidden: true, budgeted: 500, actuals: -100, balance: 400 },
    { id: "other", group: "g2", budgeted: 800, actuals: -800, balance: 0 },
  ];
  const build = (mode: "tracking" | "envelope") =>
    buildVarianceModel({
      mode,
      side: "expense",
      months: ["2026-08"],
      groupIds: ["g1"],
      statesByMonth: statesFor({ "2026-08": specs }),
    });

  it("includes a group's hidden categories in Envelope and not in Tracking", () => {
    expect(build("envelope").categories.map((c) => c.id).sort()).toEqual(["old", "shown"]);
    expect(build("tracking").categories.map((c) => c.id)).toEqual(["shown"]);
  });

  it("never reaches another group", () => {
    expect(build("envelope").categories.some((c) => c.id === "other")).toBe(false);
  });
});

describe("income budget fallback", () => {
  const base = makeState([{ id: "salary", income: true, group: "gi", budgeted: 0, actuals: 5000 }]);
  const withFallback = { ...base, incomeBudgetFallbackIds: ["salary"] };
  const budgets = new Map([["2026-08", new Map([["salary", 6000]])]]);

  it("fills a missing income budget from the separate query", () => {
    const filled = applyIncomeBudgetFallback(withFallback, "2026-08", budgets);
    expect(filled.categoriesById.salary.budgeted).toBe(6000);
    expect(filled).not.toBe(withFallback);
  });

  it("leaves a state alone when nothing needs it", () => {
    expect(applyIncomeBudgetFallback(base, "2026-08", budgets)).toBe(base);
    expect(applyIncomeBudgetFallback(withFallback, "2026-08", undefined)).toBe(withFallback);
  });

  it("uses zero for a month the query has no row for", () => {
    const seeded = { ...withFallback, categoriesById: { salary: { ...withFallback.categoriesById.salary, budgeted: 999 } } };
    expect(applyIncomeBudgetFallback(seeded, "2026-07", budgets).categoriesById.salary.budgeted).toBe(0);
  });
});

describe("history months to load", () => {
  const closed = (m: string) => m < "2026-09";
  const available = (months: string[]) => new Set(months);

  it("loads last year's months when they are all there", () => {
    const set = available(["2025-06", "2025-07", "2025-08", "2026-01"]);
    expect(chooseHistoryMonths(["2026-06", "2026-07", "2026-08"], set, closed)).toEqual(["2025-06", "2025-07", "2025-08"]);
  });

  it("falls back to the previous six when last year is incomplete or the period is short", () => {
    const set = available(["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
    expect(chooseHistoryMonths(["2026-08"], set, closed)).toEqual(["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
    // Jun-Aug has no complete year-ago, so it reads the six months before June that exist.
    expect(chooseHistoryMonths(["2026-06", "2026-07", "2026-08"], set, closed)).toEqual(["2026-02", "2026-03", "2026-04", "2026-05"]);
  });

  it("skips months the budget does not have", () => {
    expect(chooseHistoryMonths(["2026-08"], available(["2026-06", "2026-07"]), closed)).toEqual(["2026-06", "2026-07"]);
  });
});
