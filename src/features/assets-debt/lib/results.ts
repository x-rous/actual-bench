import type { DebtProjection, DebtProjectionEvent } from "@/lib/financial-models/loan/projection";
import type { SimulationState } from "./simulatorModel";

/**
 * Headline figures, deltas and chart series from a projection (RD-084 P1.3b
 * T210, T211). Pure and library-free: `LoanProjectionChart` only renders the
 * series built here, and holds no financial logic.
 */

export type Headline = {
  /** The most common scheduled repayment; null when there is none (a line of credit with no payments). */
  regularRepaymentMinor: number | null;
  /** True when the scheduled repayment changes over the loan (interest-only, rate changes, recasts). */
  repaymentChanges: boolean;
  totalRepaidMinor: number;
  totalInterestMinor: number;
  /** The date the balance reaches zero, or null when it does not within the projection. */
  payoffDate: string | null;
  closingBalanceMinor: number;
};

const CASH_OUT = new Set(["repayment", "final-payment", "extra-repayment", "balloon"]);

export function headline(events: readonly DebtProjectionEvent[]): Headline {
  const scheduled = events.filter((e) => e.eventType === "repayment").map((e) => -e.cashMovementMinor);
  const counts = new Map<number, number>();
  for (const a of scheduled) counts.set(a, (counts.get(a) ?? 0) + 1);
  let regular: number | null = null;
  for (const [amount, n] of counts) if (regular === null || n > counts.get(regular)!) regular = amount;
  const payoff = events.find((e) => e.balanceBeforeMinor > 0 && e.balanceAfterMinor === 0 && e.eventType !== "interest-charge");
  return {
    regularRepaymentMinor: regular,
    repaymentChanges: counts.size > 1,
    totalRepaidMinor: events.filter((e) => CASH_OUT.has(e.eventType)).reduce((s, e) => s - e.cashMovementMinor, 0),
    totalInterestMinor: events.reduce((s, e) => s + e.interestMinor, 0),
    payoffDate: payoff?.date ?? null,
    closingBalanceMinor: events.at(-1)?.balanceAfterMinor ?? 0,
  };
}

export type Deltas = { interestMinor: number; repaymentMinor: number | null; payoffDays: number | null };

/** Current minus baseline: negative interest is interest saved; negative days is paid off earlier. */
export function deltas(current: Headline, baseline: Headline): Deltas {
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  return {
    interestMinor: current.totalInterestMinor - baseline.totalInterestMinor,
    repaymentMinor: current.regularRepaymentMinor !== null && baseline.regularRepaymentMinor !== null ? current.regularRepaymentMinor - baseline.regularRepaymentMinor : null,
    payoffDays: current.payoffDate && baseline.payoffDate ? day(current.payoffDate) - day(baseline.payoffDate) : null,
  };
}

export type SeriesId = "balance" | "comparison" | "offsetBalance" | "interestBearing" | "cumulativeInterest";
export type ChartPoint = { period: string } & Partial<Record<SeriesId, number>>;
export type ChartData = { points: ChartPoint[]; series: SeriesId[] };

/** Offset balances as entered (dated absolute values), summed across offsets, in force at `date`. */
function offsetBalanceAt(sim: SimulationState, date: string): number {
  let total = 0;
  for (const o of sim.offsets) {
    if (o.effectiveFrom > date || (o.effectiveTo !== null && o.effectiveTo <= date)) continue;
    const changes = sim.assumptions.filter((a) => a.kind === "offset-balance" && a.offsetAccountId === o.placeholderAccountId && a.effectiveFrom <= date).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    total += changes.at(-1)?.amountMinor ?? 0;
  }
  return total;
}

/**
 * Chart series per month or year. The balance and comparison come from the
 * engine; the interest-bearing balance from its diagnostics; the offset
 * balance is the input itself. A series whose values are all zero is dropped.
 */
export function chartSeries(projection: DebtProjection, sim: SimulationState, options: { view: "month" | "year"; comparison?: DebtProjection | null }): ChartData {
  if (!projection.ok) return { points: [], series: [] };
  const keyOf = (date: string) => (options.view === "month" ? date.slice(0, 7) : date.slice(0, 4));
  const byPeriod = new Map<string, ChartPoint>();
  let cumulative = 0;
  for (const e of projection.events) {
    const period = keyOf(e.date);
    const point = byPeriod.get(period) ?? { period };
    cumulative += e.interestMinor;
    point.balance = e.balanceAfterMinor;
    point.cumulativeInterest = cumulative;
    if (typeof e.diagnostics.interestBearingMinor === "number") point.interestBearing = e.diagnostics.interestBearingMinor;
    if (sim.offsets.length) point.offsetBalance = offsetBalanceAt(sim, e.date);
    byPeriod.set(period, point);
  }
  if (options.comparison?.ok) {
    for (const e of options.comparison.events) {
      const period = keyOf(e.date);
      const point = byPeriod.get(period) ?? { period };
      point.comparison = e.balanceAfterMinor;
      byPeriod.set(period, point);
    }
  }
  const points = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
  const candidates: SeriesId[] = ["balance", ...(options.comparison?.ok ? (["comparison"] as const) : []), "offsetBalance", "interestBearing", "cumulativeInterest"];
  const series = candidates.filter((id) => points.some((p) => (p[id] ?? 0) !== 0));
  return { points, series };
}
