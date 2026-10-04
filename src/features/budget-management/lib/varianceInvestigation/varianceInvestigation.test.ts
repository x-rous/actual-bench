import { addMonths } from "@/lib/budget/monthMath";
import { buildBaseline, historyMonths } from "./varianceBaseline";
import { buildSelectionFacts, recentMonths } from "./varianceFacts";
import {
  normalizeCategoryCell,
  pctOfBudget,
  shareOfSide,
  splitGross,
  unfavourableAmount,
  vocabulary,
} from "./varianceMath";
import {
  defaultSelection,
  effectiveDriverIds,
  filterDrivers,
  resolveSelection,
  selectedCategoryIds,
  toggleSelection,
} from "./varianceSelection";
import { aggregateFor, buildVarianceModel, type VarianceInput } from "./varianceViewModel";
import { buildWaterfall } from "./varianceWaterfall";
import { statesFor, type CategorySpec } from "./testing";

/** Tracking expense, as the payload gives it: budget and spend both negative. */
const exp = (
  id: string,
  budget: number,
  spent: number,
  extra: Partial<CategorySpec> = {}
): CategorySpec => ({ id, budgeted: -budget, actuals: -spent, ...extra });

const MONTH = "2026-08";

function model(
  specs: CategorySpec[],
  extra: Partial<VarianceInput> = {}
) {
  return buildVarianceModel({
    mode: "tracking",
    side: "expense",
    months: [MONTH],
    statesByMonth: statesFor({ [MONTH]: specs }),
    ...extra,
  });
}

describe("sign handling", () => {
  it("shows expenses as positive magnitudes", () => {
    const category = statesFor({ m: [exp("a", 3000, 4200)] }).get("m")!.categoriesById.a;
    const cell = normalizeCategoryCell(category, "expense");
    expect(cell.budget).toBe(3000);
    expect(cell.actual).toBe(4200);
  });

  it("keeps a refund as a negative spend", () => {
    const category = statesFor({ m: [{ id: "a", budgeted: -1000, actuals: 250 }] }).get("m")!
      .categoriesById.a;
    expect(normalizeCategoryCell(category, "expense").actual).toBe(-250);
  });

  it("leaves income as received", () => {
    const category = statesFor({ m: [{ id: "i", income: true, budgeted: 5000, actuals: 4200 }] }).get("m")!
      .categoriesById.i;
    const cell = normalizeCategoryCell(category, "income");
    expect(cell.budget).toBe(5000);
    expect(cell.actual).toBe(4200);
  });

  it("derives carried-in money so the balance identity holds", () => {
    const category = statesFor({
      m: [{ id: "e", budgeted: 2000, actuals: -2600, balance: 900 }],
    }).get("m")!.categoriesById.e;
    const cell = normalizeCategoryCell(category, "expense");
    expect(cell.carriedIn).toBe(1500);
    expect(cell.carriedIn + cell.budget - cell.actual).toBe(cell.balance);
  });
});

describe("unfavourable amount and gross split", () => {
  it("is overspend for expenses and shortfall for income", () => {
    expect(unfavourableAmount("expense", 1000, 1300)).toBe(300);
    expect(unfavourableAmount("expense", 1000, 700)).toBe(-300);
    expect(unfavourableAmount("income", 1000, 700)).toBe(300);
    expect(unfavourableAmount("income", 1000, 1300)).toBe(-300);
  });

  it("reconciles actual = budget + overspend - savings for expenses", () => {
    const rows = [
      { budget: 1000, actual: 1500 },
      { budget: 2000, actual: 1200 },
      { budget: 500, actual: 500 },
    ];
    const gross = splitGross(rows.map((r) => unfavourableAmount("expense", r.budget, r.actual)));
    const budget = rows.reduce((t, r) => t + r.budget, 0);
    const actual = rows.reduce((t, r) => t + r.actual, 0);
    expect(gross).toEqual({ unfavourable: 500, favourable: 800, net: -300 });
    expect(actual).toBe(budget + gross.unfavourable - gross.favourable);
  });

  it("reconciles actual = budget - shortfall + surplus for income", () => {
    const rows = [
      { budget: 5000, actual: 4000 },
      { budget: 1000, actual: 1800 },
    ];
    const gross = splitGross(rows.map((r) => unfavourableAmount("income", r.budget, r.actual)));
    const budget = 6000;
    const actual = 5800;
    expect(gross.unfavourable).toBe(1000);
    expect(gross.favourable).toBe(800);
    expect(actual).toBe(budget - gross.unfavourable + gross.favourable);
  });

  it("measures a share against its own side, not the net", () => {
    const gross = splitGross([600, 400, -300, -100]);
    expect(gross.net).toBe(600);
    expect(shareOfSide(600, gross)).toBe(0.6);
    expect(shareOfSide(-300, gross)).toBe(0.75);
    expect(shareOfSide(0, gross)).toBeNull();
  });

  it("has no share when its side sums to zero, and no percentage at a zero budget", () => {
    expect(shareOfSide(10, { unfavourable: 0, favourable: 0 })).toBeNull();
    expect(pctOfBudget(500, 0)).toBeNull();
    expect(pctOfBudget(500, 2000)).toBe(0.25);
  });
});

describe("terminology", () => {
  it("uses overspent / saved for Tracking expenses", () => {
    const v = vocabulary("tracking", "expense");
    expect([v.unfavourable, v.favourable, v.netUnfavourable]).toEqual([
      "Overspent",
      "Saved",
      "over budget",
    ]);
  });

  it("uses shortfall / surplus and target wording for income", () => {
    const v = vocabulary("tracking", "income");
    expect([v.unfavourable, v.favourable, v.netUnfavourable, v.netFavourable]).toEqual([
      "Shortfall",
      "Surplus",
      "below target",
      "above target",
    ]);
  });

  it("never calls unspent Envelope money saved", () => {
    const v = vocabulary("envelope", "expense");
    expect(v.favourable).toBe("Unspent");
    expect(v.budget).toBe("Allocated");
    expect(Object.values(v).join(" ").toLowerCase()).not.toContain("saved");
  });
});

describe("variance model", () => {
  const specs = [
    exp("travel", 4000, 8000, { group: "gt" }),
    exp("flights", 6000, 7000, { group: "gt" }),
    exp("food", 3000, 3300, { group: "gf" }),
    exp("fun", 2500, 1000, { group: "gl" }),
    exp("rent", 12000, 12000, { group: "gh" }),
  ];

  it("totals, gross and net reconcile to actual", () => {
    const m = model(specs);
    expect(m.total.budget).toBe(27500);
    expect(m.total.actual).toBe(31300);
    expect(m.gross).toEqual({ unfavourable: 5300, favourable: 1500, net: 3800 });
    expect(m.total.actual).toBe(m.total.budget + m.gross.unfavourable - m.gross.favourable);
  });

  it("orders unfavourable first, largest first, then favourable", () => {
    const m = model(specs, { level: "category" });
    expect(m.drivers.map((d) => d.id)).toEqual(["travel", "flights", "food", "rent", "fun"]);
  });

  it("builds groups by default when the scope spans several, and categories for one", () => {
    expect(model(specs).level).toBe("group");
    expect(model(specs, { categoryIds: ["travel", "flights"] }).level).toBe("category");
    expect(model(specs, { categoryIds: ["food"] }).drivers.map((d) => d.id)).toEqual(["food"]);
  });

  it("rolls a group up from its categories", () => {
    const group = model(specs).drivers.find((d) => d.id === "gt")!;
    expect(group.budget).toBe(10000);
    expect(group.actual).toBe(15000);
    expect(group.categoryIds).toEqual(["travel", "flights"]);
  });

  it("leaves a category with no budget and no spending out", () => {
    const m = model([...specs, exp("idle", 0, 0, { group: "gi" })], { level: "category" });
    expect(m.drivers.some((d) => d.id === "idle")).toBe(false);
  });

  it("flags spending against a zero budget as unbudgeted with no percentage", () => {
    const m = model([...specs, exp("surprise", 0, 400, { group: "gs" })], { level: "category" });
    const driver = m.drivers.find((d) => d.id === "surprise")!;
    expect(driver.unbudgeted).toBe(true);
    expect(driver.pctOfBudget).toBeNull();
    expect(driver.variance).toBe(400);
  });

  it("counts a refund as a favourable offset", () => {
    const m = model(
      [exp("shop", 1000, 1200, { group: "gs" }), { id: "back", group: "gb", budgeted: -500, actuals: 300 }],
      { level: "category" }
    );
    const refund = m.drivers.find((d) => d.id === "back")!;
    expect(refund.actual).toBe(-300);
    expect(refund.direction).toBe("favourable");
    expect(refund.variance).toBe(-800);
    expect(m.total.actual).toBe(900);
  });

  it("leads with the favourable result when nothing is unfavourable", () => {
    const m = model([exp("a", 1000, 400), exp("b", 2000, 1500, { group: "g2" })]);
    expect(m.gross.unfavourable).toBe(0);
    expect(m.gross.net).toBe(-1100);
    // Nothing is selected, so the analysis leads with the whole (favourable) result.
    expect(defaultSelection(m)).toEqual([]);
  });

  it("reconciles income with shortfall and surplus", () => {
    const m = buildVarianceModel({
      mode: "tracking",
      side: "income",
      months: [MONTH],
      statesByMonth: statesFor({
        [MONTH]: [
          { id: "salary", income: true, group: "gi", budgeted: 5000, actuals: 4000 },
          { id: "side", income: true, group: "gj", budgeted: 1000, actuals: 1800 },
        ],
      }),
    });
    expect(m.total.budget).toBe(6000);
    expect(m.total.actual).toBe(5800);
    expect(m.gross).toEqual({ unfavourable: 1000, favourable: 800, net: 200 });
    expect(m.total.actual).toBe(m.total.budget - m.gross.unfavourable + m.gross.favourable);
    expect(m.drivers[0].id).toBe("gi");
  });

  it("offers no income view in Envelope", () => {
    const m = buildVarianceModel({
      mode: "envelope",
      side: "income",
      months: [MONTH],
      statesByMonth: statesFor({ [MONTH]: [{ id: "i", income: true, budgeted: 0, actuals: 500 }] }),
    });
    expect(m.supported).toBe(false);
    expect(m.drivers).toEqual([]);
  });
});

describe("hidden categories", () => {
  const specs = [
    exp("shown", 1000, 1100, { group: "g1" }),
    exp("old", 500, 400, { group: "g2", hidden: true }),
    exp("inHiddenGroup", 300, 500, { group: "g3" }),
  ];
  const build = (mode: "tracking" | "envelope") =>
    buildVarianceModel({
      mode,
      side: "expense",
      months: [MONTH],
      level: "category",
      statesByMonth: statesFor({ [MONTH]: specs }, { hiddenGroups: ["g3"] }),
    });

  it("excludes hidden categories and groups in Tracking", () => {
    const m = build("tracking");
    expect(m.drivers.map((d) => d.id)).toEqual(["shown"]);
    expect(m.total.budget).toBe(1000);
  });

  it("keeps them in Envelope, because hidden money is still assigned", () => {
    const m = build("envelope");
    expect(m.drivers.map((d) => d.id).sort()).toEqual(["inHiddenGroup", "old", "shown"]);
    expect(m.total.budget).toBe(1800);
    expect(m.drivers.find((d) => d.id === "old")!.hidden).toBe(true);
  });
});

describe("waterfall", () => {
  const many = [
    exp("a", 1000, 2400, { group: "g1" }),
    exp("b", 1000, 2000, { group: "g2" }),
    exp("c", 1000, 1700, { group: "g3" }),
    exp("d", 1000, 1500, { group: "g4" }),
    exp("e", 1000, 1300, { group: "g5" }),
    exp("f", 1000, 1200, { group: "g6" }),
    exp("g", 1000, 1100, { group: "g7" }),
    exp("h", 1000, 600, { group: "g8" }),
    exp("i", 1000, 500, { group: "g9" }),
    exp("j", 1000, 800, { group: "g10" }),
    exp("k", 1000, 900, { group: "g11" }),
  ];

  it("starts at budget, ends at actual and reconciles exactly", () => {
    const m = model(many);
    const w = buildWaterfall(m);
    expect(w.segments[0].to).toBe(m.total.budget);
    expect(w.segments.at(-1)!.to).toBe(m.total.actual);
    expect(w.endValue).toBe(m.total.actual);
    expect(w.reconciles).toBe(true);
  });

  it("shows the five largest unfavourable drivers and aggregates the rest", () => {
    const w = buildWaterfall(model(many));
    const named = w.segments.filter((s) => s.kind === "driver" && !s.favourable);
    expect(named.map((s) => s.key)).toEqual(["g1", "g2", "g3", "g4", "g5"]);
    const other = w.segments.find((s) => s.key === "other-u")!;
    expect(other.label).toBe("Other overspend");
    expect(other.driverIds).toEqual(["g6", "g7"]);
    expect(other.delta).toBe(300);
  });

  it("aggregates favourable offsets into Other savings and keeps every id", () => {
    const w = buildWaterfall(model(many));
    const favourable = w.segments.filter((s) => s.favourable);
    expect(favourable.map((s) => s.key)).toEqual(["g9", "g8", "other-f"]);
    const other = favourable.at(-1)!;
    expect(other.label).toBe("Other savings");
    expect(other.driverIds).toEqual(["g10", "g11"]);
  });

  it("does not turn a single leftover driver into an Other bar", () => {
    const six = many.slice(0, 6);
    const w = buildWaterfall(model(six));
    expect(w.segments.some((s) => s.kind === "other")).toBe(false);
    expect(w.segments.filter((s) => s.kind === "driver")).toHaveLength(6);
  });

  it("moves the running total down for an income shortfall", () => {
    const m = buildVarianceModel({
      mode: "tracking",
      side: "income",
      months: [MONTH],
      statesByMonth: statesFor({
        [MONTH]: [
          { id: "salary", income: true, group: "gi", budgeted: 5000, actuals: 4000 },
          { id: "side", income: true, group: "gj", budgeted: 1000, actuals: 1800 },
        ],
      }),
    });
    const w = buildWaterfall(m);
    expect(w.segments[1]).toMatchObject({ key: "gi", delta: -1000, favourable: false });
    expect(w.segments[2]).toMatchObject({ key: "gj", delta: 800, favourable: true });
    expect(w.endValue).toBe(5800);
  });
});

describe("monthly series", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
  const byMonth = Object.fromEntries(
    months.map((m, i) => [
      m,
      [exp("a", 1000, [1500, 700, 1100, 1000][i]), exp("b", 2000, [2100, 2400, 1500, 2000][i], { group: "g2" })],
    ])
  );
  const m = buildVarianceModel({
    mode: "tracking",
    side: "expense",
    months,
    statesByMonth: statesFor(byMonth),
  });

  it("makes the monthly bars sum to the net variance", () => {
    const sum = m.monthly.reduce((t, p) => t + p.variance, 0);
    expect(sum).toBe(m.gross.net);
    expect(m.monthly.map((p) => p.variance)).toEqual([600, 100, -400, 0]);
  });

  it("ends the cumulative line on the net variance", () => {
    expect(m.monthly.at(-1)!.cumulative).toBe(m.gross.net);
    expect(m.monthly.map((p) => p.cumulative)).toEqual([600, 700, 300, 300]);
  });

  it("counts the months a driver was over", () => {
    expect(m.drivers.find((d) => d.id === "g1")!.aggregate.monthsOver).toBe(2);
  });

  it("reports a missing month instead of treating it as zero", () => {
    const partial = buildVarianceModel({
      mode: "tracking",
      side: "expense",
      months,
      statesByMonth: new Map([...statesFor(byMonth)].filter(([k]) => k !== "2026-02")),
    });
    expect(partial.missingMonths).toEqual(["2026-02"]);
    expect(partial.monthly[1].present).toBe(false);
    expect(partial.total.monthsPresent).toBe(3);
  });
});

describe("Envelope balances", () => {
  /*
   * A walk with a deficit that carries over (a) and one that does not (b):
   *   a: Jan  budget 100, spent 160, balance -60, carryover on
   *      Feb  carried in -60, budget 100, spent 20, balance 20
   *   b: Jan  budget 100, spent 160, balance -60, carryover off
   *      Feb  carried in 0 (the deficit was wiped), budget 100, spent 20, balance 80
   */
  const months = ["2026-01", "2026-02"];
  const env = (id: string, group: string, carryover: boolean, jan: number, feb: number) => ({
    id,
    group,
    carryover,
    jan: { budgeted: 100, actuals: -160, balance: jan },
    feb: { budgeted: 100, actuals: -20, balance: feb },
  });
  const rows = [env("a", "g1", true, -60, 20), env("b", "g2", false, -60, 80)];
  const states = statesFor({
    "2026-01": rows.map((r) => ({ id: r.id, group: r.group, carryover: r.carryover, ...r.jan })),
    "2026-02": rows.map((r) => ({ id: r.id, group: r.group, carryover: r.carryover, ...r.feb })),
  });
  const m = buildVarianceModel({ mode: "envelope", side: "expense", months, statesByMonth: states });
  const e = m.total.envelope!;

  it("explains the closing balance as carried in + allocated - spent + cleared", () => {
    expect(e.carriedIn).toBe(0);
    expect(e.clearedFromToBudget).toBe(60);
    expect(e.closing).toBe(100);
    expect(e.carriedIn + m.total.budget - m.total.actual + e.clearedFromToBudget).toBe(e.closing);
    expect(e.otherAdjustments).toBe(0);
  });

  it("separates a deficit that carries over from one that is cleared", () => {
    expect(e.rolledByMonth).toEqual([60, 0]);
    expect(e.clearedByMonth).toEqual([60, 0]);
    expect(e.deficitByMonth).toEqual([120, 0]);
    expect(e.deficitMonths).toBe(1);
  });

  it("reports what is open at the end of the period", () => {
    expect(e.deficit).toBe(0);
    expect(e.available).toBe(100);
    const january = buildVarianceModel({
      mode: "envelope",
      side: "expense",
      months: ["2026-01"],
      statesByMonth: states,
    }).total.envelope!;
    expect(january.deficit).toBe(120);
    // The last month's deficits are still open, so nothing is cleared yet.
    expect(january.clearedFromToBudget).toBe(0);
    expect(january.carryoverCount).toBe(1);
  });

  it("tells a deficit from an overspend covered by carried-in money", () => {
    const covered = buildVarianceModel({
      mode: "envelope",
      side: "expense",
      months: ["2026-08"],
      level: "category",
      statesByMonth: statesFor({
        "2026-08": [
          { id: "covered", group: "g1", budgeted: 100, actuals: -150, balance: 250 },
          { id: "deficit", group: "g2", budgeted: 100, actuals: -150, balance: -50 },
          { id: "spare", group: "g3", budgeted: 100, actuals: -20, balance: 80 },
        ],
      }),
    });
    const status = Object.fromEntries(covered.drivers.map((d) => [d.id, d.status]));
    expect(status).toEqual({ covered: "covered", deficit: "deficit", spare: "available" });
    expect(defaultSelection(covered)).toEqual([]);
    expect(filterDrivers(covered.drivers, "deficit").map((d) => d.id)).toEqual(["deficit"]);
  });
});

describe("selection", () => {
  const m = model([exp("a", 1000, 1500, { group: "g1" }), exp("b", 1000, 1200, { group: "g2" }), exp("c", 1000, 400, { group: "g3" })]);

  it("opens with nothing selected, which means everything in view", () => {
    expect(defaultSelection(m)).toEqual([]);
    expect(effectiveDriverIds(m, [])).toEqual(["g1", "g2", "g3"]);
    expect(effectiveDriverIds(m, ["g2"])).toEqual(["g2"]);
  });

  it("selects the only driver when there is just one", () => {
    const single = model([exp("only", 1000, 1400)]);
    expect(single.drivers).toHaveLength(1);
    expect(defaultSelection(single)).toEqual(["only"]);
  });

  it("replaces on a plain click and toggles on Ctrl/Cmd", () => {
    expect(toggleSelection(["g1"], ["g2"], false)).toEqual(["g2"]);
    expect(toggleSelection(["g1"], ["g2"], true)).toEqual(["g1", "g2"]);
    expect(toggleSelection(["g1", "g2"], ["g2"], true)).toEqual(["g1"]);
    expect(toggleSelection(["g1"], ["g1"], true)).toBeNull();
  });

  it("selects every driver an aggregated segment stands for", () => {
    expect(toggleSelection(["g1"], ["g2", "g3"], true)).toEqual(["g1", "g2", "g3"]);
    expect(toggleSelection(["g1", "g2", "g3"], ["g2", "g3"], true)).toEqual(["g1"]);
  });

  it("falls back to the default when a selection no longer exists", () => {
    expect(resolveSelection(m, ["gone"])).toEqual([]);
    expect(resolveSelection(m, null)).toEqual([]);
    expect(resolveSelection(m, ["g3"])).toEqual(["g3"]);
  });

  it("resolves a group to its categories without duplicates", () => {
    const grouped = model([
      exp("a", 1000, 1500, { group: "g1" }),
      exp("b", 1000, 1200, { group: "g1" }),
      exp("c", 1000, 900, { group: "g2" }),
    ]);
    expect(selectedCategoryIds(grouped, ["g1"])).toEqual(["a", "b"]);
    expect(selectedCategoryIds(grouped, ["g1", "g1"])).toEqual(["a", "b"]);
    // Never reaches a category of an unrelated group.
    expect(selectedCategoryIds(grouped, ["g1"])).not.toContain("c");
  });

  it("filters the list by direction", () => {
    expect(filterDrivers(m.drivers, "unfavourable").map((d) => d.id)).toEqual(["g1", "g2"]);
    expect(filterDrivers(m.drivers, "favourable").map((d) => d.id)).toEqual(["g3"]);
    expect(filterDrivers(m.drivers, "all")).toHaveLength(3);
  });
});

describe("historical baseline", () => {
  const closedBefore = (cutoff: string) => (month: string) => month < cutoff;
  const allMonths = (from: string, count: number) =>
    Array.from({ length: count }, (_, i) => addMonths(from, i));
  const flat = (monthList: string[], spent: (m: string) => number) =>
    statesFor(Object.fromEntries(monthList.map((m) => [m, [exp("a", 1000, spent(m))]])));
  const build = (monthList: string[], states: ReturnType<typeof flat>, period: string[]) => {
    const m = buildVarianceModel({ mode: "tracking", side: "expense", months: period, statesByMonth: states });
    return buildBaseline({ model: m, categoryIds: ["a"], months: period, isClosed: closedBefore("2026-09") });
  };

  it("prefers the same period last year when it is complete", () => {
    const period = ["2026-06", "2026-07", "2026-08"];
    const everything = allMonths("2025-01", 20);
    const states = flat(everything, (m) => (m.startsWith("2025") ? 900 : 1500));
    const base = build(everything, states, period)!;
    expect(base.kind).toBe("year-ago");
    expect(base.months).toEqual(["2025-06", "2025-07", "2025-08"]);
    expect(base.typicalPerMonth).toBe(900);
  });

  it("falls back to the median of the previous six months for a single month", () => {
    const everything = allMonths("2026-01", 8);
    const states = flat(everything, (m) => ({ "2026-02": 800, "2026-03": 900, "2026-04": 1000, "2026-05": 5000, "2026-06": 1100, "2026-07": 1200 } as Record<string, number>)[m] ?? 700);
    const base = build(everything, states, ["2026-08"])!;
    expect(base.kind).toBe("median");
    // Median, so the 5,000 outlier does not drag it up.
    expect(base.typicalPerMonth).toBe(1050);
  });

  it("needs at least three historical months", () => {
    const everything = allMonths("2026-06", 3);
    expect(build(everything, flat(everything, () => 1000), ["2026-08"])).toBeNull();
    const four = allMonths("2026-04", 5);
    expect(build(four, flat(four, () => 1000), ["2026-08"])?.months).toHaveLength(4);
  });

  it("does not use a month that is still open", () => {
    const everything = allMonths("2026-01", 8);
    const states = flat(everything, () => 1000);
    const m = buildVarianceModel({ mode: "tracking", side: "expense", months: ["2026-08"], statesByMonth: states });
    const base = buildBaseline({ model: m, categoryIds: ["a"], months: ["2026-08"], isClosed: closedBefore("2026-07") });
    expect(base?.months.every((x) => x < "2026-07")).toBe(true);
  });

  it("lists the months a caller has to load first", () => {
    expect(historyMonths(["2026-08"])).toEqual([
      "2025-08", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
    ]);
  });
});

describe("selection facts", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
  const run = (spend: number[], extra: Partial<VarianceInput> = {}) => {
    const states = statesFor(
      Object.fromEntries(
        months.map((month, i) => [
          month,
          [exp("a", 1000, spend[i]), exp("b", 1000, 900, { group: "g2" })],
        ])
      )
    );
    return buildVarianceModel({ mode: "tracking", side: "expense", months, statesByMonth: states, ...extra });
  };

  it("takes its share from the gross side", () => {
    const m = run([1500, 1500, 1500, 1500]);
    const facts = buildSelectionFacts({ model: m, driverIds: ["g1"], baseline: null });
    expect(facts.shareUnfavourable).toBe(1);
    expect(facts.aggregate.monthsOver).toBe(4);
    expect(facts.budgetUsed).toBe(1.5);
  });

  it("calls overspending in most months a repeat, and one month unusual", () => {
    const repeat = buildSelectionFacts({ model: run([1500, 1500, 1500, 900]), driverIds: ["g1"], baseline: null });
    expect(repeat.pattern.tags).toContain("repeated");
    const unusual = buildSelectionFacts({ model: run([900, 900, 900, 1600]), driverIds: ["g1"], baseline: null });
    expect(unusual.pattern.tags).toEqual(["unusual"]);
    const none = buildSelectionFacts({ model: run([900, 900, 900, 900]), driverIds: ["g1"], baseline: null });
    expect(none.pattern.tags).toEqual([]);
  });

  it("flags a budget well under typical spending", () => {
    const m = run([1500, 1500, 1500, 1500]);
    const facts = buildSelectionFacts({
      model: m,
      driverIds: ["g1"],
      baseline: { kind: "median", months: [], typicalPerMonth: 1400 },
    });
    expect(facts.pattern.tags).toContain("budget-below-typical");
  });

  it("finds the peak month and the biggest member category", () => {
    const m = buildVarianceModel({
      mode: "tracking",
      side: "expense",
      months: ["2026-01", "2026-02"],
      statesByMonth: statesFor({
        "2026-01": [exp("x", 1000, 1100, { group: "g1" }), exp("y", 1000, 1600, { group: "g1" })],
        "2026-02": [exp("x", 1000, 1200, { group: "g1" }), exp("y", 1000, 2400, { group: "g1" })],
      }),
    });
    // One group in scope, so the drivers are its categories.
    const facts = buildSelectionFacts({ model: m, driverIds: ["x", "y"], baseline: null });
    expect(facts.peakMonth).toEqual({ month: "2026-02", variance: 1600 });
    expect(facts.topCategory?.name).toBe("y");
    expect(facts.topCategory!.share).toBeCloseTo(2000 / 2300);
  });

  it("reads a single month against the months before it", () => {
    const states = statesFor(
      Object.fromEntries(
        ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].map((m) => [m, [exp("a", 1000, 1500)]])
      )
    );
    const m = buildVarianceModel({ mode: "tracking", side: "expense", months: ["2026-08"], statesByMonth: states });
    const facts = buildSelectionFacts({ model: m, driverIds: ["a"], baseline: null });
    expect(recentMonths(["2026-08"])).toHaveLength(6);
    expect(facts.pattern).toMatchObject({ months: 6, over: 6 });
    expect(facts.pattern.tags).toContain("repeated");
  });

  it("aggregates any subset of categories over any months", () => {
    const m = run([1500, 1500, 1500, 1500]);
    const part = aggregateFor(m, ["a"], ["2026-01", "2026-02"]);
    expect(part.budget).toBe(2000);
    expect(part.actual).toBe(3000);
  });
});
