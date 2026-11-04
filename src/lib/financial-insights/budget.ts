import { buildEnvelopePeriodView, type EnvelopePeriodMonth } from "@/features/budget-management/lib/semantics/envelopePeriodView";
import { envelopeInputsFromState, trackingInputsFromState } from "@/features/budget-management/lib/semantics/fromLoadedState";
import { computeEnvelopeFunding } from "@/features/budget-management/lib/semantics/envelopeBudgetSemantics";
import { buildTrackingPeriodView, type TrackingPeriodMonth } from "@/features/budget-management/lib/semantics/trackingPeriodView";
import { classifyMonthActualStatus } from "@/features/budget-management/lib/budgetDetailsModel";
import type { LoadedCategory, LoadedMonthState } from "@/features/budget-management/types";
import type { SpendingBreakdown } from "./breakdowns";
import type { Ledger } from "./measures";
import { addMonths } from "./period";

/**
 * My budget: the plan the owner keeps in Actual, set against what happened, in the budget's real mode. Pure: it takes the month
 * payloads Actual returns (the same ones Budget Cockpit reads) and returns the rows the tab draws. Every plan and spent figure is
 * Actual's own; the only arithmetic is summing months and counting them. All amounts are integer minor units, and "spent" is
 * positive for money spent (Actual returns it negative). A month that could not be read is never zero.
 */

export type PlanMode = "tracking" | "envelope";
export type Phase = "past" | "current" | "future";

/** What reading one budget month came to. `unavailable`: Actual has no such month. `failed`: it has, but the read did not work. */
export type MonthRead = { month: string; status: "ok"; state: LoadedMonthState } | { month: string; status: "unavailable" | "failed" };

/**
 * How a category-month stands. Tracking: `under`, `on` or `over` its saved plan, or `unplanned` (spending while the plan is 0: Actual returns 0 both for no plan and for a plan of 0).
 * Envelope: `covered` (balance at or above zero), `carried` (negative, but the category carries its overspending forward) or
 * `uncovered` (negative and not carried, so Actual takes it from the next month).
 */
export type CellState = "under" | "on" | "over" | "unplanned" | "covered" | "carried" | "uncovered";

export type PlanCell = {
  /** Actual's spent for the category; positive is money spent, a net refund is negative. */
  spentMinor: number;
  /** The saved plan (Tracking) or assignment (Envelope). */
  planMinor: number;
  /** The category balance (Envelope; Tracking carries it too but does not use it). */
  balanceMinor: number;
  state: CellState;
  /** 1 or 2: how far from the plan (over: within or beyond a quarter above it; under: a quarter or more below it is 2). */
  level: 1 | 2;
};

export type PlanMonth = {
  month: string;
  phase: Phase;
  /** The current month: it runs to today, so it is shown but never counted. */
  partial: boolean;
  status: "ok" | "unavailable" | "failed";
  /** Planned spending (Tracking) or money assigned to categories (Envelope). */
  plannedMinor: number | null;
  spentMinor: number | null;
  /** Tracking: income received, and the income that was planned. */
  incomeMinor: number | null;
  plannedIncomeMinor: number | null;
  /** Envelope: overspending Actual took from the next month. */
  uncoveredMinor: number | null;
  /** Over its plan (Tracking, only with a plan) or needing adjustment (Envelope). */
  missed: boolean | null;
  /** Spent in all expense categories, hidden ones included, and the part of it in categories with no plan saved (Tracking). */
  categorySpentMinor: number | null;
  unplannedMinor: number | null;
};

export type PlanRow = {
  id: string;
  name: string;
  groupName: string;
  /** Hidden itself or in a hidden group. Actual's Tracking totals leave such categories out; Financial Insights spending keeps them. */
  hidden: boolean;
  order: number;
  /** One per entry of `months`; null when nothing happened or the month is not read. */
  cells: (PlanCell | null)[];
  /** The category's balance at the end of each month, also in a month with no cell (nothing spent); null when the month is not read. */
  balances: (number | null)[];
  /** Over the completed months that were read. */
  spentMinor: number;
  planMinor: number;
};

export type PlanGroup = {
  name: string;
  /** Every category of the group is hidden. */
  hidden: boolean;
  order: number;
  categoryIds: string[];
  cells: (PlanCell | null)[];
  /** The sum of its categories' balances at each month's end; null when the month is not read. */
  balances: (number | null)[];
  rows: PlanRow[];
  spentMinor: number;
  planMinor: number;
};

/** A category that missed its plan (Tracking) or ran short (Envelope) in some completed months. */
export type MissRow = {
  id: string;
  /** The categories behind the row: one, or every category of a group. */
  categoryIds: string[];
  /** Hidden category, or a group whose categories are all hidden. */
  hidden: boolean;
  name: string;
  groupName: string;
  /** Months over plan (spending with no plan counts), or months left uncovered. */
  monthsMissed: number;
  /** Completed months, read, in which the category had a plan, spending or a balance to speak of. */
  monthsCounted: number;
  /** The most consecutive completed months missed. */
  longestStreak: number;
  /** Of the months missed, those with spending and no plan (Tracking). */
  unplannedMonths: number;
  /** What was spent in those months. */
  unplannedMinor: number;
  /** Total spent beyond plan (Tracking) or total left uncovered (Envelope). */
  amountMinor: number;
  /** Actual's spent for the category over the completed months, the figure its transactions add up to. */
  spentMinor: number;
};

export type PlanKpis =
  | { state: "empty" }
  /** These completed months could not be read, so the figures that need them are not shown. */
  | { state: "unavailable"; months: string[] }
  | {
      state: "ready";
      mode: "tracking";
      months: number;
      plannedMinor: number;
      spentMinor: number;
      /** Planned less spent: positive is under plan. */
      varianceMinor: number;
      monthsOver: number;
      /** Completed months that had a plan. */
      monthsWithPlan: number;
      plannedIncomeMinor: number;
      incomeMinor: number;
      /** Received less planned. */
      incomeVarianceMinor: number;
      /** Planned income less planned spending, and received less spent. */
      plannedSavingsMinor: number;
      actualSavingsMinor: number;
    }
  | {
      state: "ready";
      mode: "envelope";
      months: number;
      assignedMinor: number;
      spentMinor: number;
      uncoveredMinor: number;
      monthsNeedingAdjustment: number;
      /** Category balances at the end of the period (the latest month read), not a bank balance. */
      leftMinor: number;
      leftMonth: string;
    };

export type ReconciliationPart = {
  key: "categorizedTransfers" | "uncategorized" | "offBudget" | "registry" | "hidden";
  /** What the part adds to Actual's spending to reach the Spending tab's, signed: Actual's figure minus Spending's. */
  contributionMinor: number;
  /** The same amount as money spent (positive), as the list behind it adds up. */
  spentMinor: number;
  /** The categories behind the part, when it is a set of categories (hidden categories). */
  categoryIds?: string[];
};

/** Actual's spending set against the Spending tab's, over the same completed months. Never forced to zero. */
export type Reconciliation = {
  months: string[];
  actualMinor: number;
  spendingMinor: number;
  /** Actual's figure minus Spending's. */
  differenceMinor: number;
  parts: ReconciliationPart[];
  /** What the parts do not explain. */
  otherMinor: number;
  /** The categories that make up `otherMinor`, largest first, so the figure can be traced to transactions. */
  otherRows: { id: string; name: string; /** Actual's spent for the category over the months; opens its transactions. */ actualMinor: number; differenceMinor: number }[];
};

export type BudgetPlan = {
  mode: PlanMode;
  months: PlanMonth[];
  /** Completed months that were read, oldest first. */
  completed: string[];
  unavailable: string[];
  failed: string[];
  kpis: PlanKpis;
  groups: PlanGroup[];
  misses: MissRow[];
  /** The same by category group. */
  groupMisses: MissRow[];
  /** Tracking: spending in months with no plan saved, over the completed months. */
  unplanned: { amountMinor: number; spendingMinor: number; categories: number } | null;
  /** Tracking: hidden categories, which Actual's totals leave out and Financial Insights spending keeps. */
  hidden: { categoryIds: string[] } | null;
  reconciliation: Reconciliation | null;
};

const phaseOf = (month: string, today: string): Phase => {
  const status = classifyMonthActualStatus(month, new Date(`${today}T12:00:00`));
  return status === "past" ? "past" : status === "future" ? "future" : "current";
};

/** Spent is positive for money spent. */
const spentOf = (c: LoadedCategory) => 0 - c.actuals;

function cellOf(mode: PlanMode, c: LoadedCategory): PlanCell | null {
  const spent = spentOf(c);
  const plan = c.budgeted;
  if (mode === "envelope") {
    // Nothing spent and nothing assigned: no cell. An assignment that was not spent is still part of the plan.
    if (spent === 0 && c.balance >= 0 && plan === 0) return null;
    return { spentMinor: spent, planMinor: plan, balanceMinor: c.balance, state: c.balance >= 0 ? "covered" : c.carryover ? "carried" : "uncovered", level: 1 };
  }
  // Spending with no plan is unplanned; a month with nothing spent, or a net refund, is not overspending.
  if (plan === 0) return spent === 0 ? null : { spentMinor: spent, planMinor: 0, balanceMinor: c.balance, state: spent > 0 ? "unplanned" : "under", level: 1 };
  const ratio = spent / plan;
  const state: CellState = spent > plan ? "over" : spent === plan ? "on" : "under";
  return { spentMinor: spent, planMinor: plan, balanceMinor: c.balance, state, level: state === "over" ? (ratio > 1.25 ? 2 : 1) : state === "under" ? (ratio < 0.75 ? 2 : 1) : 1 };
}

/** A group's cell from its categories' cells in one month. */
function groupCell(mode: PlanMode, cells: (PlanCell | null)[]): PlanCell | null {
  const live = cells.filter((c): c is PlanCell => c !== null);
  if (live.length === 0) return null;
  const spent = live.reduce((a, c) => a + c.spentMinor, 0);
  const plan = live.reduce((a, c) => a + c.planMinor, 0);
  const balance = live.reduce((a, c) => a + c.balanceMinor, 0);
  if (mode === "envelope") {
    const state: CellState = live.some((c) => c.state === "uncovered") ? "uncovered" : live.some((c) => c.state === "carried") ? "carried" : "covered";
    return { spentMinor: spent, planMinor: plan, balanceMinor: balance, state, level: 1 };
  }
  if (plan === 0) return spent === 0 ? null : { spentMinor: spent, planMinor: 0, balanceMinor: balance, state: spent > 0 ? "unplanned" : "under", level: 1 };
  const ratio = spent / plan;
  const state: CellState = spent > plan ? "over" : spent === plan ? "on" : "under";
  return { spentMinor: spent, planMinor: plan, balanceMinor: balance, state, level: state === "over" ? (ratio > 1.25 ? 2 : 1) : state === "under" ? (ratio < 0.75 ? 2 : 1) : 1 };
}

/**
 * One category's (or group's) cell over several months, such as a quarter: what was spent and planned added up, then judged
 * the same way as a single month. In an Envelope budget the balance is the last month's, and the state the worst of the months
 * (uncovered, then carried, then covered). A month with no cell adds nothing; with no cell at all there is none.
 */
export function combineCells(mode: PlanMode, cells: readonly (PlanCell | null)[], lastBalance?: number | null): PlanCell | null {
  const live = cells.filter((c): c is PlanCell => c !== null);
  const combined = groupCell(mode, live);
  // The balance is the final month's even when that month has no cell (nothing was spent in it); `lastBalance` carries it.
  return combined && mode === "envelope" ? { ...combined, balanceMinor: lastBalance ?? live[live.length - 1].balanceMinor } : combined;
}

const missed = (mode: PlanMode, cell: PlanCell | null) => (mode === "tracking" ? cell?.state === "over" || cell?.state === "unplanned" : cell?.state === "uncovered");

export type BuildInput = {
  mode: PlanMode;
  /** Every month of the period (at most the cap), oldest first, each with what reading it came to. */
  reads: readonly MonthRead[];
  today: string;
  /** For the reconciliation to the Spending tab; omitted in tests that do not need it. */
  ledger?: Ledger;
  breakdown?: SpendingBreakdown;
};

export function buildBudgetPlan({ mode, reads, today, ledger, breakdown }: BuildInput): BudgetPlan {
  const byMonth = new Map(reads.map((r) => [r.month, r]));
  const okState = (month: string) => {
    const r = byMonth.get(month);
    return r?.status === "ok" ? r.state : null;
  };
  const phases = reads.map((r) => phaseOf(r.month, today));
  const completed = reads.filter((r, i) => r.status === "ok" && phases[i] === "past").map((r) => r.month);
  const unavailable = reads.filter((r) => r.status === "unavailable").map((r) => r.month);
  const failed = reads.filter((r) => r.status === "failed").map((r) => r.month);
  const failedCompleted = reads.filter((r, i) => r.status === "failed" && phases[i] === "past").map((r) => r.month);

  // Overspending Actual took from the next month: its own figure when the next month was read, else the balances that cause it.
  const uncoveredFor = (month: string, state: LoadedMonthState): number => {
    const next = okState(addMonths(month, 1));
    if (next) return Math.max(0, 0 - next.summary.lastMonthOverspent);
    return Object.values(state.categoriesById).reduce((a, c) => (!c.isIncome && c.balance < 0 && !c.carryover ? a + (0 - c.balance) : a), 0);
  };

  const months: PlanMonth[] = reads.map((r, i) => {
    const base = { month: r.month, phase: phases[i], partial: phases[i] === "current", status: r.status };
    if (r.status !== "ok") return { ...base, plannedMinor: null, spentMinor: null, incomeMinor: null, plannedIncomeMinor: null, uncoveredMinor: null, missed: null, categorySpentMinor: null, unplannedMinor: null };
    if (mode === "tracking") {
      const t = trackingInputsFromState(r.state);
      return { ...base, plannedMinor: t.budgetedExpenseAllocation, spentMinor: 0 - t.signedExpenseActivity, incomeMinor: t.actualIncome, plannedIncomeMinor: t.budgetedIncome, uncoveredMinor: null, missed: t.budgetedExpenseAllocation > 0 ? 0 - t.signedExpenseActivity > t.budgetedExpenseAllocation : null, categorySpentMinor: null, unplannedMinor: null };
    }
    const e = computeEnvelopeFunding(envelopeInputsFromState(r.state));
    const uncovered = uncoveredFor(r.month, r.state);
    return { ...base, plannedMinor: Math.abs(e.budgetedAllocation), spentMinor: 0 - e.signedSpent, incomeMinor: e.incomeReceived, plannedIncomeMinor: null, uncoveredMinor: uncovered, missed: uncovered > 0, categorySpentMinor: null, unplannedMinor: null };
  });

  // ─── Categories and groups ───────────────────────────────────────────────
  const latest = [...reads].reverse().find((r) => r.status === "ok");
  const order = new Map<string, number>();
  if (latest && latest.status === "ok") {
    latest.state.groupOrder.forEach((gid, gi) => latest.state.groupsById[gid]?.categoryIds.forEach((cid, ci) => order.set(cid, gi * 100_000 + ci)));
  }
  const info = new Map<string, LoadedCategory>();
  // Hidden is a property of the category (or its group), the same in every month's payload.
  const hiddenIds = new Set<string>();
  for (const r of reads) {
    if (r.status !== "ok") continue;
    for (const c of Object.values(r.state.categoriesById)) {
      if (c.isIncome) continue;
      info.set(c.id, c);
      if (c.hidden || r.state.groupsById[c.groupId]?.hidden) hiddenIds.add(c.id);
    }
  }
  const completedIndex = new Set(reads.flatMap((r, i) => (r.status === "ok" && phases[i] === "past" ? [i] : [])));

  const rows = new Map<string, PlanRow>();
  for (const [id, c] of info) {
    const cells = reads.map((r) => {
      if (r.status !== "ok") return null;
      const cat = r.state.categoriesById[id];
      return cat && !cat.isIncome ? cellOf(mode, cat) : null;
    });
    let spent = 0, plan = 0;
    cells.forEach((cell, i) => { if (cell && completedIndex.has(i)) { spent += cell.spentMinor; plan += cell.planMinor; } });
    if (cells.every((cell) => cell === null)) continue;
    const balances = reads.map((r) => (r.status === "ok" ? r.state.categoriesById[id]?.balance ?? null : null));
    rows.set(id, { id, name: c.name, groupName: c.groupName, hidden: hiddenIds.has(id), order: order.get(id) ?? Number.MAX_SAFE_INTEGER, cells, balances, spentMinor: spent, planMinor: plan });
  }
  if (mode === "tracking") {
    months.forEach((m, i) => {
      if (m.status !== "ok") return;
      let all = 0, unplanned = 0;
      for (const r of rows.values()) {
        const c = r.cells[i];
        if (!c) continue;
        all += c.spentMinor;
        if (c.state === "unplanned") unplanned += c.spentMinor;
      }
      m.categorySpentMinor = all; m.unplannedMinor = unplanned;
    });
  }
  const groupMap = new Map<string, PlanRow[]>();
  for (const row of rows.values()) groupMap.set(row.groupName, [...(groupMap.get(row.groupName) ?? []), row]);
  const groups: PlanGroup[] = [...groupMap].map(([name, list]) => {
    const sorted = [...list].sort((a, b) => a.order - b.order);
    const cells = reads.map((_, i) => groupCell(mode, sorted.map((r) => r.cells[i])));
    const balances = reads.map((_, i) => { const known = sorted.flatMap((r) => (r.balances[i] === null ? [] : [r.balances[i] as number])); return known.length ? known.reduce((a, v) => a + v, 0) : null; });
    return {
      name, hidden: sorted.every((r) => r.hidden), order: sorted[0]?.order ?? Number.MAX_SAFE_INTEGER, categoryIds: sorted.map((r) => r.id), cells, balances, rows: sorted,
      spentMinor: sorted.reduce((a, r) => a + r.spentMinor, 0), planMinor: sorted.reduce((a, r) => a + r.planMinor, 0),
    };
  }).sort((a, b) => a.order - b.order);

  // ─── Where the plan missed / where funds ran short ───────────────────────
  // One pass for a category and for a group: a month is missed when its cell is (Tracking: over its plan, or spending with no
  // plan; Envelope: uncovered). A group's amount is its categories' amounts, so it adds up to what its rows show.
  const missRow = (id: string, name: string, groupName: string, categoryIds: string[], cells: (PlanCell | null)[], spentMinor: number, children: PlanRow[]): MissRow | null => {
    const hidden = children.length > 0 && children.every((r) => r.hidden);
    let counted = 0, count = 0, streak = 0, longest = 0, amount = 0, unplanned = 0, unplannedMinor = 0;
    reads.forEach((_, i) => {
      if (!completedIndex.has(i)) { streak = 0; return; }
      const cell = cells[i];
      if (cell) counted++;
      // Unplanned spending is counted category by category, so a group shows what its categories spent with no budget saved
      // even when the group as a whole stayed within its budget.
      const unplannedHere = children.reduce((a, r) => (r.cells[i]?.state === "unplanned" ? a + r.cells[i]!.spentMinor : a), 0);
      if (unplannedHere > 0) { unplanned++; unplannedMinor += unplannedHere; }
      if (missed(mode, cell) && cell) {
        count++; streak++; longest = Math.max(longest, streak);
        amount += mode === "tracking" ? cell.spentMinor - cell.planMinor : children.reduce((a, r) => (r.cells[i]?.state === "uncovered" ? a + (0 - r.cells[i]!.balanceMinor) : a), 0);
      } else streak = 0;
    });
    return count > 0 || unplannedMinor > 0 ? { id, categoryIds, hidden, name, groupName, monthsMissed: count, monthsCounted: counted, longestStreak: longest, unplannedMonths: unplanned, unplannedMinor, amountMinor: amount, spentMinor } : null;
  };
  const order_ = mode === "tracking" ? (a: MissRow, b: MissRow) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name) : (a: MissRow, b: MissRow) => b.monthsMissed - a.monthsMissed || b.amountMinor - a.amountMinor || a.name.localeCompare(b.name);
  const misses: MissRow[] = [...rows.values()].flatMap((r) => { const m = missRow(r.id, r.name, r.groupName, [r.id], r.cells, r.spentMinor, [r]); return m ? [m] : []; }).sort(order_);
  const groupMisses: MissRow[] = groups.flatMap((g) => { const m = missRow(g.name, g.name, g.name, g.categoryIds, g.cells, g.spentMinor, g.rows); return m ? [m] : []; }).sort(order_);
  let unplannedAmount = 0, unplannedCategories = 0, categorySpending = 0;
  for (const r of rows.values()) {
    categorySpending += r.spentMinor;
    const u = r.cells.reduce((a, c, i) => (completedIndex.has(i) && c?.state === "unplanned" ? a + c.spentMinor : a), 0);
    if (u !== 0) { unplannedAmount += u; unplannedCategories++; }
  }
  const unplannedSummary = mode === "tracking" && unplannedCategories > 0 ? { amountMinor: unplannedAmount, spendingMinor: categorySpending, categories: unplannedCategories } : null;

  // ─── Figures ─────────────────────────────────────────────────────────────
  const completedStates = completed.map((m) => ({ month: m, state: okState(m)! }));
  let kpis: PlanKpis;
  if (completed.length === 0 && failedCompleted.length === 0) kpis = { state: "empty" };
  else if (failedCompleted.length > 0) kpis = { state: "unavailable", months: failedCompleted };
  else if (mode === "tracking") {
    const view = buildTrackingPeriodView(completedStates.map<TrackingPeriodMonth>((m) => ({ month: m.month, phase: "past", inputs: trackingInputsFromState(m.state) })));
    const closed = view?.closed;
    const done = months.filter((m) => m.status === "ok" && m.phase === "past");
    kpis = closed
      ? {
          state: "ready", mode, months: closed.monthCount, plannedMinor: closed.budgetedExpenseAllocation, spentMinor: 0 - closed.signedExpenseActivity, varianceMinor: closed.expenseVariance,
          monthsOver: done.filter((m) => m.missed === true).length, monthsWithPlan: done.filter((m) => m.missed !== null).length,
          plannedIncomeMinor: closed.budgetedIncome, incomeMinor: closed.actualIncome, incomeVarianceMinor: closed.incomeVariance,
          plannedSavingsMinor: closed.budgetedIncome - closed.budgetedExpenseAllocation, actualSavingsMinor: closed.actualSavings,
        }
      : { state: "empty" };
  } else {
    const sums = buildEnvelopePeriodView(completedStates.map<EnvelopePeriodMonth>((m) => ({ month: m.month, phase: "past", funding: computeEnvelopeFunding(envelopeInputsFromState(m.state)) })));
    const everything = buildEnvelopePeriodView(reads.flatMap<EnvelopePeriodMonth>((r, i) => (r.status === "ok" ? [{ month: r.month, phase: phases[i], funding: computeEnvelopeFunding(envelopeInputsFromState(r.state)) }] : [])));
    const done = months.filter((m) => m.status === "ok" && m.phase === "past");
    kpis = sums && everything
      ? {
          state: "ready", mode, months: done.length, assignedMinor: sums.periodBudgeted, spentMinor: 0 - sums.periodSpent,
          uncoveredMinor: done.reduce((a, m) => a + (m.uncoveredMinor ?? 0), 0), monthsNeedingAdjustment: done.filter((m) => m.missed === true).length,
          leftMinor: everything.focusBalance, leftMonth: everything.focusMonth,
        }
      : { state: "empty" };
  }

  return { mode, months, completed, unavailable, failed, kpis, groups, misses, groupMisses, unplanned: unplannedSummary, hidden: mode === "tracking" && hiddenIds.size > 0 ? { categoryIds: [...hiddenIds] } : null, reconciliation: ledger && breakdown ? reconcile(ledger, breakdown, completed, kpis, rows, mode === "tracking" ? hiddenIds : new Set()) : null };
}

// ─── Reconciliation to the Spending tab ─────────────────────────────────────

/**
 * Actual's spending against the Spending tab's, over the same completed months. Actual counts the categorized transfers of
 * on-budget accounts and everything in on-budget accounts the Asset Registry has since classified as a value change or a sale;
 * it leaves out entries with no category and everything in off-budget accounts. Spending is the reverse. The four parts come
 * from figures the page has already read; whatever they do not explain is "Other".
 */
function reconcile(ledger: Ledger, breakdown: SpendingBreakdown, completed: readonly string[], kpis: PlanKpis, planRows: ReadonlyMap<string, PlanRow>, hiddenIds: ReadonlySet<string>): Reconciliation | null {
  if (kpis.state !== "ready") return null;
  const actual = kpis.spentMinor;
  const inScope = new Set(completed);
  const slots = breakdown.months.map((m) => inScope.has(m));
  const total = (rows: SpendingBreakdown["rows"]) => rows.reduce((a, r) => a + r.byMonth.reduce((s, v, i) => (slots[i] ? s + v : s), 0), 0);
  const spending = total(breakdown.rows);
  const uncategorized = total(breakdown.rows.filter((r) => r.id === null));
  const { facts, account } = ledger;
  const spendingBy = new Map(breakdown.rows.filter((r) => r.id !== null).map((r) => [r.id as string, total([r])] as const));
  let transfers = 0, offBudget = 0;
  // The same parts by category, to find where what is left over sits.
  const explained = new Map<string, number>();
  const note = (id: string, v: number) => explained.set(id, (explained.get(id) ?? 0) + v);
  for (const row of facts.movement) {
    const owner = account.get(row.accountId);
    // Hidden categories are one part of their own below (Tracking), so they are not counted again here.
    if (!owner || !inScope.has(row.month) || row.categoryId === null || facts.incomeCategories.has(row.categoryId) || hiddenIds.has(row.categoryId)) continue;
    if (row.transferAccountId) { if (!owner.offBudget) { transfers += 0 - row.amountMinor; note(row.categoryId, 0 - row.amountMinor); } }
    else if (owner.offBudget) { offBudget += 0 - row.amountMinor; note(row.categoryId, row.amountMinor); }
  }
  // Spending takes a registry-classified entry back out of its category; Actual still counts it where the account is on budget.
  let registry = 0;
  for (const row of facts.reclassified) {
    const owner = account.get(row.accountId);
    if (!owner || !inScope.has(row.month) || row.categoryId === null || facts.incomeCategories.has(row.categoryId) || hiddenIds.has(row.categoryId)) continue;
    if (owner.offBudget) { offBudget += row.amountMinor; note(row.categoryId, 0 - row.amountMinor); } else { registry += 0 - row.amountMinor; note(row.categoryId, 0 - row.amountMinor); }
  }
  // Actual's Tracking totals leave hidden categories out; Spending keeps them, at Spending's own figure for them.
  const hiddenSpending = [...hiddenIds].reduce((a, id) => a + (spendingBy.get(id) ?? 0), 0);
  const hiddenWithSpending = [...hiddenIds].filter((id) => (spendingBy.get(id) ?? 0) !== 0);
  const all: ReconciliationPart[] = [
    { key: "categorizedTransfers", contributionMinor: transfers, spentMinor: transfers },
    { key: "uncategorized", contributionMinor: 0 - uncategorized, spentMinor: uncategorized },
    { key: "offBudget", contributionMinor: 0 - offBudget, spentMinor: offBudget },
    { key: "registry", contributionMinor: registry, spentMinor: registry },
    { key: "hidden", contributionMinor: 0 - hiddenSpending, spentMinor: hiddenSpending, categoryIds: hiddenWithSpending },
  ];
  const parts = all.filter((p) => p.contributionMinor !== 0);
  const difference = actual - spending;
  const otherRows = [...new Set([...planRows.keys(), ...spendingBy.keys(), ...explained.keys()])]
    .map((id) => {
      // Actual's totals leave a hidden category out (Tracking); its whole difference is the hidden part above.
      const actualMinor = hiddenIds.has(id) ? 0 : (planRows.get(id)?.spentMinor ?? 0);
      return { id, name: planRows.get(id)?.name ?? breakdown.rows.find((r) => r.id === id)?.name ?? "Unknown category", actualMinor, differenceMinor: actualMinor - (spendingBy.get(id) ?? 0) - (explained.get(id) ?? 0) + (hiddenIds.has(id) ? (spendingBy.get(id) ?? 0) : 0) };
    })
    .filter((r) => r.differenceMinor !== 0).sort((a, b) => Math.abs(b.differenceMinor) - Math.abs(a.differenceMinor));
  return { months: [...completed], actualMinor: actual, spendingMinor: spending, differenceMinor: difference, parts, otherMinor: difference - parts.reduce((a, p) => a + p.contributionMinor, 0), otherRows };
}
