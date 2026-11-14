import { SECTIONS, SECTION_SIGN, type Goal, type Month, type PlanDocument, type PlanRow, type SectionId } from "./types";
import type { Placed, Snapshot } from "./actuals";
import { ruleAmount } from "./document";
import { addMonths, monthIndex, monthRange } from "./months";

/**
 * The plan calculated month by month. Pure: a document, the placement of Actual's movements (or none), and the result.
 *
 * Months before the current one show what Actual recorded. The current month shows what was recorded so far plus what is
 * still expected. Later months show the forecast: a typed cell, else the row's basis. Closing cash chains from the real
 * balance, so a forecast always starts from what is in the accounts today.
 */

export type MonthKind = "actual" | "current" | "forecast";

/** Where a shown amount comes from. */
export type CellSource = "actual" | "cell" | "rule" | "average" | "budget" | "schedule" | "loan" | "none";

export type RowResult = {
  /** The amount each month counts with (natural minor units). */
  values: number[];
  /** What Actual recorded, for past months and the current one; null elsewhere. */
  actual: (number | null)[];
  /** What the plan says: for a forecast month its forecast, for a past month what was typed or repeated (null when the plan says nothing). */
  plan: (number | null)[];
  source: CellSource[];
  /** The monthly average the row's forecast starts from, when its basis is the average. */
  typical: number | null;
  /** Why the basis cannot give a forecast, when it cannot. */
  problem?: string;
};

export type GoalResult = { goal: Goal; /** Projected balance in the goal's month, or null when the month is outside the plan. */ projected: number | null; shortfall: number | null; /** What to add each month from now to close the shortfall. */ perMonth: number | null };

export type Computed = {
  months: Month[];
  kinds: MonthKind[];
  /** Index of the current month, or -1 when it is outside the plan (or the plan does not use Actual). */
  currentIndex: number;
  rows: Map<string, RowResult>;
  groupTotals: Map<string, number[]>;
  sectionTotals: Record<SectionId, number[]>;
  /** "Not in plan" per section (natural), for past months and the current one. */
  unplanned: Record<SectionId, number[]>;
  /** Cash-signed lines outside the sections. */
  inTransit: number[];
  /** What counting transactions in another month took out of or added to each month, so the balances stay real. */
  moved: number[];
  startingBalances: number[];
  net: number[];
  opening: number[];
  closing: number[];
  belowMinimum: boolean[];
  /** Estimated savings balance; null when the plan has no savings accounts and no savings rows. */
  savings: number[] | null;
  kpis: {
    /** The cash balance today (the opening balance for a plan that does not use Actual). */
    cashNow: number;
    /** The lowest closing balance from the current month on, over the next 12 months and over the whole plan. */
    lowest12: { month: Month; amount: number } | null;
    lowestAll: { month: Month; amount: number } | null;
    firstBelow: Month | null;
    endOfYear: { month: Month; amount: number } | null;
    endOfPlan: { month: Month; amount: number };
    /** The next 12 forecast months, summed (natural). */
    next12: { income: number; expenses: number; savings: number; debt: number; net: number; months: number };
  };
  goals: GoalResult[];
};

const zeros = (n: number): number[] => new Array<number>(n).fill(0);

/**
 * What is still expected of a row in the current month, given the plan for the whole month and what was recorded so far.
 * A plan already met or passed expects nothing more; a recorded amount going the other way (a refund) does not use up the plan.
 */
function remaining(plan: number, actual: number): number {
  if (plan === 0) return 0;
  if (actual === 0 || Math.sign(actual) !== Math.sign(plan)) return plan;
  return Math.abs(plan) > Math.abs(actual) ? plan - actual : 0;
}

function categoriesOf(row: PlanRow, snapshot: Snapshot): string[] {
  const groups = new Set(row.links.categoryGroups);
  const ids = new Set(row.links.categories);
  for (const c of snapshot.categories) if (groups.has(c.groupId)) ids.add(c.id);
  return [...ids];
}

export function computePlan(doc: PlanDocument, snapshot: Snapshot | null, placed: Placed | null): Computed {
  const count = doc.years * 12;
  const months = monthRange(doc.startMonth, count);
  const live = doc.useActuals && snapshot && placed ? { snapshot, placed } : null;
  const currentMonth = live ? live.snapshot.today.slice(0, 7) : null;
  const currentIndex = currentMonth ? months.indexOf(currentMonth) : -1;
  const kinds: MonthKind[] = months.map((m) => (!currentMonth ? "forecast" : m < currentMonth ? "actual" : m === currentMonth ? "current" : "forecast"));
  const firstIndex = monthIndex(doc.startMonth);
  const at = (month: Month) => monthIndex(month) - firstIndex;

  // ── Row forecasts ──────────────────────────────────────────────────────────
  const rows = new Map<string, RowResult>();
  for (const row of doc.rows) {
    const recorded = live?.placed.rowActual.get(row.id);
    const result: RowResult = { values: zeros(count), actual: new Array(count).fill(null), plan: new Array(count).fill(null), source: new Array<CellSource>(count).fill("none"), typical: null };

    // What the basis gives per month, for the current month and later.
    let basis: (month: Month, index: number) => { amount: number; source: CellSource } | null = () => null;
    /** The basis only knows what is still to come (dated occurrences), so in the current month it adds to what was recorded. */
    let datedBasis = false;
    switch (row.basis.kind) {
      case "manual": {
        basis = (month) => {
          let sum = 0, hit = false;
          for (const rule of row.rules) { const amount = ruleAmount(rule, month); if (amount !== null) { sum += amount; hit = true; } }
          return hit ? { amount: sum, source: "rule" } : null;
        };
        break;
      }
      case "average": {
        if (!live || !currentMonth) { result.problem = "Needs Actual data"; break; }
        // The last complete months, no further back than the data goes.
        const available = live.placed.firstMonth ? Math.max(0, monthIndex(currentMonth) - monthIndex(live.placed.firstMonth)) : 0;
        const window = Math.min(row.basis.months, available);
        if (window === 0) { result.problem = "No complete month of history yet"; break; }
        let sum = 0;
        for (let k = 1; k <= window; k++) sum += recorded?.get(addMonths(currentMonth, -k)) ?? 0;
        const typical = Math.round(sum / window);
        result.typical = typical;
        const growth = row.basis.growthPct ?? 0;
        const base = monthIndex(currentMonth);
        basis = (month) => ({ amount: growth ? Math.round(typical * Math.pow(1 + growth / 100, Math.floor(Math.max(0, monthIndex(month) - base) / 12))) : typical, source: "average" });
        break;
      }
      case "budget": {
        const budget = live?.snapshot.budget;
        if (!budget || !budget.lastMonth) { result.problem = live ? "No budget month could be read" : "Needs Actual data"; break; }
        const ids = categoriesOf(row, live!.snapshot);
        if (ids.length === 0) { result.problem = "Link a category to use its budget"; break; }
        basis = (month) => {
          const values = budget.months[month] ?? budget.months[budget.lastMonth!];
          if (!values) return null;
          return { amount: ids.reduce((sum, id) => sum + (values[id] ?? 0), 0), source: "budget" };
        };
        break;
      }
      case "schedule": {
        if (!live) { result.problem = "Needs Actual data"; break; }
        const wanted = new Set(row.basis.scheduleIds);
        const byMonth = new Map<Month, number>();
        const problems: string[] = [];
        for (const schedule of live.snapshot.schedules) {
          if (!wanted.has(schedule.id)) continue;
          wanted.delete(schedule.id);
          if (schedule.completed) continue;
          if (schedule.dates === null || schedule.amount === null) { problems.push(`${schedule.name}: ${schedule.problem ?? "no amount or dates"}`); continue; }
          for (const date of schedule.dates) {
            // An occurrence that is overdue is still expected: it counts in the current month.
            const month = currentMonth && date.slice(0, 7) < currentMonth ? currentMonth : date.slice(0, 7);
            byMonth.set(month, (byMonth.get(month) ?? 0) + schedule.amount * SECTION_SIGN[row.section]);
          }
        }
        if (wanted.size > 0) problems.push(`${wanted.size} linked schedule${wanted.size === 1 ? " no longer exists" : "s no longer exist"}`);
        if (row.basis.scheduleIds.length === 0) problems.push("Choose a schedule");
        if (problems.length) result.problem = problems.join("; ");
        datedBasis = true;
        basis = (month) => ({ amount: byMonth.get(month) ?? 0, source: "schedule" });
        break;
      }
      case "loan": {
        if (!live) { result.problem = "Needs Actual data"; break; }
        const byMonth = new Map<Month, number>();
        const problems: string[] = [];
        let found = 0;
        const principalOnly = row.basis.count === "principal";
        for (const link of row.links.accounts) {
          const loan = live.snapshot.loans[link.id];
          if (!loan) continue;
          found++;
          if (loan.state === "unavailable") { problems.push(loan.reason); continue; }
          for (const [due, amount] of Object.entries(principalOnly ? loan.principal : loan.payment)) {
            const month = currentMonth && due < currentMonth ? currentMonth : due;
            byMonth.set(month, (byMonth.get(month) ?? 0) + amount * -SECTION_SIGN[row.section]);
          }
        }
        if (found === 0) problems.push("Link a loan account that is tracked in Loans");
        if (problems.length) result.problem = problems.join("; ");
        datedBasis = true;
        basis = (month) => ({ amount: byMonth.get(month) ?? 0, source: "loan" });
        break;
      }
    }

    for (let i = 0; i < count; i++) {
      const month = months[i];
      const cell = row.cells[month];
      if (kinds[i] === "actual") {
        const actual = recorded?.get(month) ?? 0;
        result.actual[i] = actual;
        result.values[i] = actual;
        result.source[i] = "actual";
        // What the plan said for a month that has passed: only what was typed or set to repeat can be known.
        if (cell !== undefined) result.plan[i] = cell;
        else if (row.basis.kind === "manual") result.plan[i] = basis(month, i)?.amount ?? null;
        continue;
      }
      const fromBasis = cell !== undefined ? { amount: cell, source: "cell" as CellSource } : basis(month, i);
      const plan = fromBasis?.amount ?? 0;
      result.plan[i] = plan;
      if (kinds[i] === "current") {
        const actual = recorded?.get(month) ?? 0;
        result.actual[i] = actual;
        const dated = datedBasis && cell === undefined;
        result.values[i] = actual + (dated ? plan : remaining(plan, actual));
        result.source[i] = fromBasis?.source ?? "none";
        if (dated) result.plan[i] = actual + plan;
      } else {
        result.values[i] = plan;
        result.source[i] = fromBasis?.source ?? "none";
      }
    }
    rows.set(row.id, result);
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  const groupTotals = new Map<string, number[]>(doc.groups.map((g) => [g.id, zeros(count)]));
  const sectionTotals = Object.fromEntries(SECTIONS.map((s) => [s, zeros(count)])) as Record<SectionId, number[]>;
  const unplanned = Object.fromEntries(SECTIONS.map((s) => [s, zeros(count)])) as Record<SectionId, number[]>;
  for (const row of doc.rows) {
    const values = rows.get(row.id)!.values;
    const group = row.groupId ? groupTotals.get(row.groupId) : undefined;
    const section = sectionTotals[row.section];
    for (let i = 0; i < count; i++) { section[i] += values[i]; if (group) group[i] += values[i]; }
  }
  const inTransit = zeros(count), startingBalances = zeros(count), moved = zeros(count);
  if (live) {
    for (const section of SECTIONS) {
      for (const [month, amount] of live.placed.unplanned[section]) {
        const i = at(month);
        if (i >= 0 && i < count && kinds[i] !== "forecast") { unplanned[section][i] += amount; sectionTotals[section][i] += amount; }
      }
    }
    for (const [month, amount] of live.placed.inTransit) { const i = at(month); if (i >= 0 && i < count) inTransit[i] += amount; }
    for (const [month, amount] of live.placed.startingCash) { const i = at(month); if (i >= 0 && i < count) startingBalances[i] += amount; }
    for (const [month, amount] of live.placed.moved) { const i = at(month); if (i >= 0 && i < count) moved[i] += amount; }
  }

  // ── Balances ───────────────────────────────────────────────────────────────
  const net = zeros(count), opening = zeros(count), closing = zeros(count);
  let balance = doc.openingBalance;
  if (live) {
    // Everything recorded before the plan's first month.
    balance = 0;
    for (const [month, amount] of live.placed.cashChange) if (month < doc.startMonth) balance += amount;
  }
  const cashNow = live ? [...live.placed.cashChange.values()].reduce((sum, amount) => sum + amount, 0) : doc.openingBalance;
  for (let i = 0; i < count; i++) {
    let flow = inTransit[i] + moved[i] + startingBalances[i];
    for (const section of SECTIONS) flow += sectionTotals[section][i] * SECTION_SIGN[section];
    // A plan that starts in the future starts from today's balance.
    if (live && i === 0 && kinds[0] === "forecast") balance = cashNow;
    net[i] = flow - startingBalances[i];
    opening[i] = balance;
    balance += flow;
    closing[i] = balance;
  }
  const belowMinimum = closing.map((amount, i) => doc.minimumCash !== null && kinds[i] !== "actual" && amount < doc.minimumCash);

  // ── Savings estimate ───────────────────────────────────────────────────────
  let savings: number[] | null = null;
  const hasSavingsRows = doc.rows.some((r) => r.section === "savings");
  if ((live && live.placed.savingsIds.size > 0) || hasSavingsRows) {
    savings = zeros(count);
    const change = live?.placed.savingsChange ?? new Map<Month, number>();
    const total = [...change.values()].reduce((sum, amount) => sum + amount, 0);
    const savingsRows = doc.rows.filter((r) => r.section === "savings").map((r) => rows.get(r.id)!);
    let running = 0;
    // A plan that starts in the future starts from today's balance.
    if (live && kinds[0] === "forecast") running = total;
    else for (const [month, amount] of change) if (month < doc.startMonth) running += amount;
    const monthly = doc.savingsGrowthPct ? Math.pow(1 + doc.savingsGrowthPct / 100, 1 / 12) - 1 : 0;
    for (let i = 0; i < count; i++) {
      if (kinds[i] === "actual") running += change.get(months[i]) ?? 0;
      // Today's balance, plus what the plan still expects to be put aside this month.
      else if (kinds[i] === "current") running = total + savingsRows.reduce((sum, r) => sum + r.values[i] - (r.actual[i] ?? 0), 0);
      else running = Math.round(running * (1 + monthly)) + sectionTotals.savings[i];
      savings[i] = running;
    }
  }

  // ── Key figures ────────────────────────────────────────────────────────────
  const from = Math.max(0, currentIndex);
  const lowest = (to: number) => {
    let best: { month: Month; amount: number } | null = null;
    for (let i = from; i < Math.min(count, to); i++) if (!best || closing[i] < best.amount) best = { month: months[i], amount: closing[i] };
    return best;
  };
  const firstBelowIndex = belowMinimum.findIndex((below, i) => below && i >= from);
  const yearEndMonth = `${(currentMonth ?? months[0]).slice(0, 4)}-12`;
  const yearEndIndex = at(yearEndMonth);
  const next12 = { income: 0, expenses: 0, savings: 0, debt: 0, net: 0, months: 0 };
  // The next twelve whole months: the current month is partly behind us, so it is left out when later months exist.
  const forecastFrom = currentIndex >= 0 ? currentIndex + 1 : 0;
  for (let i = forecastFrom; i < Math.min(count, forecastFrom + 12); i++) {
    for (const section of SECTIONS) next12[section] += sectionTotals[section][i];
    next12.net += net[i];
    next12.months++;
  }

  const goals = doc.goals.map((goal): GoalResult => {
    const i = at(goal.month);
    if (i < 0 || i >= count) return { goal, projected: null, shortfall: null, perMonth: null };
    const projected = closing[i] + (goal.basis === "total" ? savings?.[i] ?? 0 : 0);
    const shortfall = Math.max(0, goal.amount - projected);
    const monthsLeft = i - from;
    return { goal, projected, shortfall, perMonth: shortfall > 0 && monthsLeft > 0 ? Math.ceil(shortfall / monthsLeft) : shortfall > 0 ? shortfall : 0 };
  });

  return {
    months, kinds, currentIndex, rows, groupTotals, sectionTotals, unplanned, inTransit, moved, startingBalances, net, opening, closing, belowMinimum, savings,
    kpis: {
      cashNow,
      lowest12: lowest(from + 12),
      lowestAll: lowest(count),
      firstBelow: firstBelowIndex >= 0 ? months[firstBelowIndex] : null,
      endOfYear: yearEndIndex >= 0 && yearEndIndex < count ? { month: yearEndMonth, amount: closing[yearEndIndex] } : null,
      endOfPlan: { month: months[count - 1], amount: closing[count - 1] },
      next12,
    },
    goals,
  };
}
