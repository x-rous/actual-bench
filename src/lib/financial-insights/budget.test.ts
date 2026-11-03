import type { LoadedCategory, LoadedMonthState } from "@/features/budget-management/types";
import { buildBudgetPlan, combineCells, type MonthRead, type PlanCell } from "./budget";
import { spendingBreakdown, type CategoryInfo } from "./breakdowns";
import { monthlyFlows } from "./breakdowns";
import { buildLedger, type AccountFact, type FinancialFacts, type MovementRow } from "./measures";
import { resolvePeriod } from "./period";

// "Today" is mid-November 2026, so Oct 2026 is the last completed month and Nov 2026 is the partial one.
const today = "2026-11-18";

/** An expense category as the month payload carries it: spent is negative, a plan of 0 is a plain 0. */
const expense = (id: string, group: string, budgeted: number, spent: number, balance = 0, extra: Partial<LoadedCategory> = {}): LoadedCategory => ({
  id, name: id[0].toUpperCase() + id.slice(1), groupId: group, groupName: group, isIncome: false, hidden: false, budgeted, actuals: 0 - spent, balance, carryover: false, ...extra,
});
const income = (id: string, budgeted: number, received: number): LoadedCategory => ({ id, name: id, groupId: "Income", groupName: "Income", isIncome: true, hidden: false, budgeted, actuals: received, balance: 0, carryover: false });

function monthState(month: string, cats: LoadedCategory[], over: Partial<LoadedMonthState["summary"]> = {}): LoadedMonthState {
  const expenses = cats.filter((c) => !c.isIncome);
  const incomes = cats.filter((c) => c.isIncome);
  const groupIds = [...new Set(cats.map((c) => c.groupId))];
  return {
    summary: {
      month, incomeAvailable: 0, lastMonthOverspent: 0, forNextMonth: 0,
      // Tracking payloads are normalised to a negative allocation at the transport boundary.
      totalBudgeted: 0 - expenses.reduce((a, c) => a + c.budgeted, 0), toBudget: 0, fromLastMonth: 0,
      totalIncome: incomes.reduce((a, c) => a + c.actuals, 0), totalSpent: expenses.reduce((a, c) => a + c.actuals, 0), totalBalance: expenses.reduce((a, c) => a + c.balance, 0), ...over,
    },
    groupsById: Object.fromEntries(groupIds.map((g) => [g, { id: g, name: g, isIncome: g === "Income", hidden: false, categoryIds: cats.filter((c) => c.groupId === g).map((c) => c.id), budgeted: 0, actuals: 0, balance: 0 }])),
    categoriesById: Object.fromEntries(cats.map((c) => [c.id, c])),
    groupOrder: groupIds,
    incomeBudgetFallbackIds: [],
  };
}
const ok = (month: string, cats: LoadedCategory[], over?: Partial<LoadedMonthState["summary"]>): MonthRead => ({ month, status: "ok", state: monthState(month, cats, over) });

describe("my budget: tracking", () => {
  // Food: plan 300 and spent 400 in Jan, 200 in Feb, 350 in Mar; Fun has no plan and spends; Rent is on plan.
  const reads: MonthRead[] = [
    ok("2026-08", [expense("food", "Daily", 30_000, 40_000), expense("fun", "Daily", 0, 5_000), expense("rent", "Home", 100_000, 100_000), income("pay", 200_000, 210_000)]),
    ok("2026-09", [expense("food", "Daily", 30_000, 20_000), expense("fun", "Daily", 0, 0), expense("rent", "Home", 100_000, 100_000), income("pay", 200_000, 200_000)]),
    ok("2026-10", [expense("food", "Daily", 30_000, 35_000), expense("fun", "Daily", 0, 2_000), expense("rent", "Home", 100_000, 100_000), income("pay", 200_000, 190_000)]),
    ok("2026-11", [expense("food", "Daily", 30_000, 10_000), expense("rent", "Home", 100_000, 100_000), income("pay", 200_000, 0)]),
  ];
  const plan = buildBudgetPlan({ mode: "tracking", reads, today });

  it("counts only completed months and marks the current one partial", () => {
    expect(plan.completed).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(plan.months.map((m) => [m.phase, m.partial])).toEqual([["past", false], ["past", false], ["past", false], ["current", true]]);
  });

  it("totals equal the sum of the month figures", () => {
    const k = plan.kpis;
    if (k.state !== "ready" || k.mode !== "tracking") throw new Error("not ready");
    const done = plan.months.filter((m) => m.phase === "past");
    expect(k.plannedMinor).toBe(done.reduce((a, m) => a + (m.plannedMinor ?? 0), 0));
    expect(k.spentMinor).toBe(done.reduce((a, m) => a + (m.spentMinor ?? 0), 0));
    expect(k.plannedMinor).toBe(3 * 130_000);
    expect(k.spentMinor).toBe(145_000 + 120_000 + 137_000);
    expect(k.varianceMinor).toBe(k.plannedMinor - k.spentMinor);
    expect(k.incomeVarianceMinor).toBe(600_000 - 600_000 + (210_000 + 200_000 + 190_000) - 600_000);
    expect(k.plannedSavingsMinor).toBe(3 * (200_000 - 130_000));
    expect(k.actualSavingsMinor).toBe(600_000 - k.spentMinor);
  });

  it("counts a month over plan only against a plan, and not the partial month", () => {
    const k = plan.kpis;
    if (k.state !== "ready" || k.mode !== "tracking") throw new Error("not ready");
    // Aug 145,000 > 130,000 is over; Sep 120,000 and Oct 137,000: Oct is over too.
    expect(k.monthsOver).toBe(2);
    expect(k.monthsWithPlan).toBe(3);
  });

  it("shows spending against a plan of 0 as unplanned spending, and counts it as a miss", () => {
    const fun = plan.groups.flatMap((g) => g.rows).find((r) => r.id === "fun");
    expect(fun?.cells.map((c) => c?.state ?? null)).toEqual(["unplanned", null, "unplanned", null]);
    expect(plan.misses.find((m) => m.id === "fun")).toMatchObject({ monthsMissed: 2, unplannedMonths: 2, amountMinor: 7_000 });
  });

  it("ranks misses by the amount over plan, with counts and the longest streak", () => {
    expect(plan.misses.map((m) => m.id)).toEqual(["food", "fun"]);
    expect(plan.misses[0]).toMatchObject({ id: "food", monthsMissed: 2, monthsCounted: 3, longestStreak: 1, amountMinor: 10_000 + 5_000, spentMinor: 40_000 + 20_000 + 35_000 });
  });

  it("measures a streak across consecutive months", () => {
    const run = buildBudgetPlan({ mode: "tracking", today, reads: ["2026-07", "2026-08", "2026-09", "2026-10"].map((m, i) => ok(m, [expense("food", "Daily", 10_000, i === 0 ? 5_000 : 20_000)])) });
    expect(run.misses[0]).toMatchObject({ monthsMissed: 3, longestStreak: 3 });
  });

  it("shows a month Actual does not have as unavailable, and a failed month makes the totals unavailable", () => {
    const gap = buildBudgetPlan({ mode: "tracking", today, reads: [{ month: "2026-08", status: "unavailable" }, reads[1], reads[2]] });
    expect(gap.unavailable).toEqual(["2026-08"]);
    expect(gap.months[0]).toMatchObject({ status: "unavailable", plannedMinor: null, spentMinor: null });
    expect(gap.kpis.state).toBe("ready");
    const broken = buildBudgetPlan({ mode: "tracking", today, reads: [reads[0], { month: "2026-09", status: "failed" }, reads[2]] });
    expect(broken.kpis).toEqual({ state: "unavailable", months: ["2026-09"] });
    expect(broken.failed).toEqual(["2026-09"]);
  });

  it("is empty when no completed month was read", () => {
    expect(buildBudgetPlan({ mode: "tracking", today, reads: [reads[3]] }).kpis).toEqual({ state: "empty" });
  });
});

describe("my budget: envelope", () => {
  // Groceries is overspent in Aug and not carried; Dining overspends in Aug but carries it; Travel spends more than its
  // assignment in Sep and an earlier balance covers it.
  const reads: MonthRead[] = [
    ok("2026-08", [expense("groceries", "Daily", 30_000, 40_000, -10_000), expense("dining", "Daily", 10_000, 15_000, -5_000, { carryover: true }), expense("travel", "Fun", 0, 0, 50_000)], { totalBalance: 35_000 }),
    ok("2026-09", [expense("groceries", "Daily", 30_000, 20_000, 10_000), expense("dining", "Daily", 10_000, 8_000, -3_000, { carryover: true }), expense("travel", "Fun", 0, 20_000, 30_000)], { lastMonthOverspent: -10_000, totalBalance: 37_000 }),
    ok("2026-10", [expense("groceries", "Daily", 30_000, 35_000, -5_000), expense("dining", "Daily", 10_000, 0, 0), expense("travel", "Fun", 0, 0, 30_000)], { lastMonthOverspent: 0, totalBalance: 25_000 }),
  ];
  const plan = buildBudgetPlan({ mode: "envelope", reads, today });

  it("classifies coverage as covered, carried or uncovered, never calling an earlier-covered spend overspending", () => {
    const row = (id: string) => plan.groups.flatMap((g) => g.rows).find((r) => r.id === id)!;
    expect(row("groceries").cells.map((c) => c?.state)).toEqual(["uncovered", "covered", "uncovered"]);
    expect(row("dining").cells.map((c) => c?.state ?? null)).toEqual(["carried", "carried", null]);
    // Travel spent 20,000 against an assignment of 0 in September, but the balance stays positive: covered.
    expect(row("travel").cells[1]).toMatchObject({ state: "covered", spentMinor: 20_000, planMinor: 0 });
  });

  it("takes the uncovered amount from Actual's next month, and from the balances for the last month read", () => {
    expect(plan.months.map((m) => m.uncoveredMinor)).toEqual([10_000, 0, 5_000]);
    expect(plan.months.map((m) => m.missed)).toEqual([true, false, true]);
  });

  it("totals the assigned, spent and uncovered amounts and reports the end balance as category balances", () => {
    const k = plan.kpis;
    if (k.state !== "ready" || k.mode !== "envelope") throw new Error("not ready");
    expect(k).toMatchObject({ assignedMinor: 3 * 40_000, spentMinor: 55_000 + 48_000 + 35_000, uncoveredMinor: 15_000, monthsNeedingAdjustment: 2, leftMinor: 25_000, leftMonth: "2026-10", months: 3 });
  });

  it("ranks the categories left uncovered by months, with the longest run", () => {
    expect(plan.misses).toHaveLength(1);
    expect(plan.misses[0]).toMatchObject({ id: "groceries", monthsMissed: 2, longestStreak: 1, amountMinor: 15_000 });
  });
});

// ─── Reconciliation to the Spending tab ─────────────────────────────────────

describe("my budget: reconciliation to the Spending tab", () => {
  const accounts: AccountFact[] = [
    { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false },
    { id: "sav", name: "Savings", accountClass: "bank", treatment: null, offBudget: true },
  ];
  const categories = new Map<string, CategoryInfo>([
    ["food", { id: "food", name: "Food", groupName: "Daily", hidden: false, isIncome: false }],
    ["pay", { id: "pay", name: "Pay", groupName: "Income", hidden: false, isIncome: true }],
  ]);
  const row = (month: string, accountId: string, categoryId: string | null, amountMinor: number, transferAccountId: string | null = null): MovementRow => ({ month, accountId, categoryId, transferAccountId, amountMinor, count: 1 });
  const movement: MovementRow[] = [
    row("2026-09", "chk", "food", -20_000), row("2026-10", "chk", "food", -30_000),
    // Actual counts a categorized transfer to an off-budget account; Spending does not.
    row("2026-10", "chk", "food", -8_000, "sav"),
    // Spending counts an entry with no category; Actual does not.
    row("2026-10", "chk", null, -3_000),
    // Spending counts a categorized entry in an off-budget account; Actual does not.
    row("2026-10", "sav", "food", -1_500),
    row("2026-10", "chk", "pay", 90_000),
  ];
  const facts: FinancialFacts = { accounts, excluded: new Set(), incomeCategories: new Set(["pay"]), movement, startingBalances: [], uncategorizedIn: [], transfersIn: [], loanCosts: [], reclassified: [] };
  const ledger = buildLedger(facts);
  const period = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-10" }, today, "2026-09");
  const breakdown = spendingBreakdown(ledger, period, categories, monthlyFlows(ledger, period, today, true));
  // Actual's own spent: Sep 20,000 and Oct 38,000 (the transfer is counted, the uncategorized and off-budget rows are not).
  const reads: MonthRead[] = [ok("2026-09", [expense("food", "Daily", 25_000, 20_000)]), ok("2026-10", [expense("food", "Daily", 25_000, 38_000)])];

  it("explains the difference with its parts, and the parts add up to it", () => {
    const rec = buildBudgetPlan({ mode: "tracking", today, reads, ledger, breakdown }).reconciliation;
    if (!rec) throw new Error("no reconciliation");
    expect(rec.actualMinor).toBe(58_000);
    expect(rec.spendingMinor).toBe(20_000 + 30_000 + 3_000 + 1_500);
    expect(rec.differenceMinor).toBe(rec.actualMinor - rec.spendingMinor);
    expect(Object.fromEntries(rec.parts.map((p) => [p.key, p.contributionMinor]))).toEqual({ categorizedTransfers: 8_000, uncategorized: -3_000, offBudget: -1_500 });
    expect(rec.otherMinor).toBe(0);
    expect(rec.parts.reduce((a, p) => a + p.contributionMinor, 0) + rec.otherMinor).toBe(rec.differenceMinor);
  });

  it("explains the entries the Asset Registry classifies, which Spending sets aside and Actual still counts", () => {
    // A 4,000 food entry in Checking that the registry calls a value change: Spending drops it, Actual keeps it.
    const withRegistry = buildLedger({ ...facts, reclassified: [{ id: "rv", payeeId: null, month: "2026-10", accountId: "chk", categoryId: "food", amountMinor: -4_000, to: "valueChange" }] });
    const bd = spendingBreakdown(withRegistry, period, categories, monthlyFlows(withRegistry, period, today, true));
    const rec = buildBudgetPlan({ mode: "tracking", today, reads, ledger: withRegistry, breakdown: bd }).reconciliation;
    expect(rec?.parts.find((p) => p.key === "registry")?.contributionMinor).toBe(4_000);
    expect(rec?.otherMinor).toBe(0);
  });

  it("shows what is left as Other and never forces it to zero", () => {
    const off = [reads[0], ok("2026-10", [expense("food", "Daily", 25_000, 40_000)])];
    const rec = buildBudgetPlan({ mode: "tracking", today, reads: off, ledger, breakdown }).reconciliation;
    expect(rec?.otherMinor).toBe(2_000);
    expect(rec?.otherRows).toEqual([{ id: "food", name: "Food", actualMinor: 60_000, differenceMinor: 2_000 }]);
  });
});

describe("my budget: hidden categories in a Tracking budget", () => {
  const accounts: AccountFact[] = [
    { id: "chk", name: "Checking", accountClass: "bank", treatment: null, offBudget: false },
    { id: "sav", name: "Savings", accountClass: "bank", treatment: null, offBudget: true },
  ];
  const categories = new Map<string, CategoryInfo>([
    ["food", { id: "food", name: "Food", groupName: "Daily", hidden: false, isIncome: false }],
    ["safe", { id: "safe", name: "Safe", groupName: "Quiet", hidden: true, isIncome: false }],
  ]);
  const row = (month: string, accountId: string, categoryId: string | null, amountMinor: number, transferAccountId: string | null = null): MovementRow => ({ month, accountId, categoryId, transferAccountId, amountMinor, count: 1 });
  const movement: MovementRow[] = [
    row("2026-09", "chk", "food", -20_000), row("2026-10", "chk", "food", -30_000),
    row("2026-09", "chk", "safe", -5_000), row("2026-10", "chk", "safe", -7_000),
    // A hidden category's transfer is part of Actual's hidden figure, not of the transfer part as well.
    row("2026-10", "chk", "safe", -2_000, "sav"),
  ];
  const ledger = buildLedger({ accounts, excluded: new Set(), incomeCategories: new Set(), movement, startingBalances: [], uncategorizedIn: [], transfersIn: [], loanCosts: [], reclassified: [] });
  const period = resolvePeriod({ kind: "custom", startMonth: "2026-09", endMonth: "2026-10" }, today, "2026-09");
  const breakdown = spendingBreakdown(ledger, period, categories, monthlyFlows(ledger, period, today, true));
  // Actual's Tracking totals leave the hidden category out; its own category figure still has it.
  const hiddenCat = (spent: number) => expense("safe", "Quiet", 0, spent, 0, { hidden: true });
  const reads: MonthRead[] = [
    ok("2026-09", [expense("food", "Daily", 25_000, 20_000), hiddenCat(5_000)], { totalSpent: -20_000, totalBudgeted: -25_000 }),
    ok("2026-10", [expense("food", "Daily", 25_000, 30_000), hiddenCat(9_000)], { totalSpent: -30_000, totalBudgeted: -25_000 }),
  ];
  const plan = buildBudgetPlan({ mode: "tracking", today, reads, ledger, breakdown });

  it("keeps hidden categories out of the totals and names them", () => {
    expect(plan.kpis).toMatchObject({ state: "ready", spentMinor: 50_000 });
    expect(plan.hidden?.categoryIds).toEqual(["safe"]);
    expect(plan.groups.flatMap((g) => g.rows).find((r) => r.id === "safe")?.hidden).toBe(true);
  });

  it("reconciles without counting the hidden category twice: it is one part and the rest is zero", () => {
    const rec = plan.reconciliation;
    if (!rec) throw new Error("no reconciliation");
    expect(rec.differenceMinor).toBe(50_000 - (50_000 + 5_000 + 7_000));
    const hidden = rec.parts.find((p) => p.key === "hidden");
    expect(hidden).toMatchObject({ contributionMinor: -12_000, spentMinor: 12_000, categoryIds: ["safe"] });
    expect(rec.parts.find((p) => p.key === "categorizedTransfers")).toBeUndefined();
    expect(rec.otherMinor).toBe(0);
    expect(rec.otherRows).toEqual([]);
    expect(rec.parts.reduce((a, p) => a + p.contributionMinor, 0) + rec.otherMinor).toBe(rec.differenceMinor);
  });

  it("treats a hidden group's categories as hidden", () => {
    const grouped = buildBudgetPlan({ mode: "tracking", today, reads: [{ month: "2026-10", status: "ok", state: { ...monthState("2026-10", [expense("a", "Vault", 0, 100)]), groupsById: { Vault: { id: "Vault", name: "Vault", isIncome: false, hidden: true, categoryIds: ["a"], budgeted: 0, actuals: 0, balance: 0 } } } }], ledger, breakdown });
    expect(grouped.hidden?.categoryIds).toEqual(["a"]);
  });
});

describe("my budget: groups and unplanned spending", () => {
  const reads: MonthRead[] = ["2026-08", "2026-09", "2026-10"].map((m, i) => ok(m, [
    expense("food", "Daily", 30_000, i === 0 ? 40_000 : 20_000), expense("fun", "Daily", 0, 6_000), expense("rent", "Home", 100_000, 100_000),
  ]));
  const plan = buildBudgetPlan({ mode: "tracking", today, reads });

  it("ranks groups by what their categories together spent beyond plan, unplanned spending included", () => {
    // Daily: plan 30,000 a month against 46,000, 26,000 and 26,000: over in August; unplanned fun counts toward the group's spend.
    expect(plan.groupMisses.map((g) => g.name)).toEqual(["Daily"]);
    expect(plan.groupMisses[0]).toMatchObject({ monthsMissed: 1, categoryIds: ["food", "fun"], amountMinor: 16_000, unplannedMonths: 3, unplannedMinor: 18_000 });
    expect(plan.misses.find((m) => m.id === "fun")).toMatchObject({ monthsMissed: 3, unplannedMonths: 3, unplannedMinor: 18_000, amountMinor: 18_000 });
  });

  it("summarises unplanned spending with its share of spending", () => {
    expect(plan.unplanned).toEqual({ amountMinor: 18_000, spendingMinor: 80_000 + 18_000 + 300_000, categories: 1 });
  });

  it("splits each month's category spending into with a plan and unplanned", () => {
    expect(plan.months.map((m) => [m.categorySpentMinor, m.unplannedMinor])).toEqual([[146_000, 6_000], [126_000, 6_000], [126_000, 6_000]]);
  });
});

describe("my budget: refunds and zero months are not overspending", () => {
  const reads: MonthRead[] = [
    ok("2026-09", [expense("lend", "Loans", 0, -4_000), expense("tech", "Quiet", 0, 0), expense("food", "Daily", 10_000, 5_000)]),
    ok("2026-10", [expense("lend", "Loans", 0, -1_000), expense("tech", "Quiet", 0, 0), expense("food", "Daily", 10_000, 5_000)]),
  ];
  const plan = buildBudgetPlan({ mode: "tracking", today, reads });

  it("shows a net refund against no plan as under, not unplanned, and a month with nothing spent as empty", () => {
    const row = (id: string) => plan.groups.flatMap((g) => g.rows).find((r) => r.id === id)!;
    expect(row("lend").cells.map((c) => c?.state)).toEqual(["under", "under"]);
    // A category with nothing in any month has no row at all.
    expect(plan.groups.flatMap((g) => g.rows).some((r) => r.id === "tech")).toBe(false);
  });

  it("never ranks them, in categories, groups or the unplanned summary", () => {
    expect(plan.misses).toEqual([]);
    expect(plan.groupMisses).toEqual([]);
    expect(plan.unplanned).toBeNull();
    expect(plan.groups.find((g) => g.name === "Loans")?.cells.map((c) => c?.state)).toEqual(["under", "under"]);
    expect(plan.groups.some((g) => g.name === "Quiet")).toBe(false);
  });
});


describe("my budget: cells over several months", () => {
  const cell = (spentMinor: number, planMinor: number, state: PlanCell["state"], balanceMinor = 0): PlanCell => ({ spentMinor, planMinor, balanceMinor, state, level: 1 });

  it("Tracking: adds the spending and the plan, then judges the total like a month", () => {
    const quarter = combineCells("tracking", [cell(900, 1_000, "under"), cell(1_200, 1_000, "over"), null]);
    expect(quarter).toMatchObject({ spentMinor: 2_100, planMinor: 2_000, state: "over", level: 1 });
    expect(combineCells("tracking", [cell(500, 1_000, "under"), cell(500, 1_000, "under")])).toMatchObject({ state: "under", level: 2 });
    expect(combineCells("tracking", [cell(1_000, 1_000, "on"), cell(1_000, 1_000, "on")])).toMatchObject({ state: "on" });
  });

  it("Tracking: spending with no plan in any month is unplanned, and nothing at all is no cell", () => {
    expect(combineCells("tracking", [cell(300, 0, "unplanned"), null])).toMatchObject({ state: "unplanned", planMinor: 0 });
    expect(combineCells("tracking", [null, null])).toBeNull();
  });

  it("Envelope: takes the worst state and the last month's balance", () => {
    const quarter = combineCells("envelope", [cell(100, 200, "covered", 300), cell(500, 100, "uncovered", -200), cell(50, 100, "covered", 40)]);
    expect(quarter).toMatchObject({ state: "uncovered", balanceMinor: 40, spentMinor: 650, planMinor: 400 });
    expect(combineCells("envelope", [cell(1, 1, "covered", 5), cell(1, 1, "carried", -1)])).toMatchObject({ state: "carried", balanceMinor: -1 });
  });
});
