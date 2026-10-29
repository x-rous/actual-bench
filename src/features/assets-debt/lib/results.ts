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

export type SeriesId = "balance" | "actualBalance" | "comparison" | "offsetBalance" | "interestBearing" | "cumulativeInterest";
/** `installment`: scheduled repayments made up to the end of the period; `elapsedMonths`: whole months from the loan's start to the end of the period. */
export type ChartPoint = {
  period: string;
  installment?: number;
  elapsedMonths?: number;
  /** Share of the opening principal repaid by the end of the period, whole percent (0 to 100). */
  repaidPercent?: number;
  /** Cash paid by scheduled and final repayments in the period (minor units), and the interest charged with them. */
  paymentMinor?: number;
  paymentInterestMinor?: number;
  /** Extra repayments in the period (minor units). */
  extraMinor?: number;
  /** A tracked loan: where the period's figures come from. */
  source?: "contract" | "actual" | "projected";
} & Partial<Record<SeriesId, number>>;

/** Whole months from `start` (an ISO date) to the end of a chart period: a month ("2026-10") or a year ("2026"). */
export function monthsElapsed(start: string, period: string): number {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const year = Number(period.slice(0, 4));
  const month = period.length > 4 ? Number(period.slice(5, 7)) : 12;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.max(0, (year - startYear) * 12 + (month - startMonth) - (lastDay < startDay ? 1 : 0));
}
export type ChartRateChange = { date: string; annualRateDecimal: string };
export type ChartRateChangeGroup = { period: string; changes: ChartRateChange[] };
export type ChartPayoff = { period: string; date: string };
export type ChartData = {
  points: ChartPoint[];
  series: SeriesId[];
  /** Contract rate changes after the opening rate, grouped at the chart's current resolution. */
  rateChanges: ChartRateChangeGroup[];
  /** The final event that settles the projected debt, provided the projection closes at zero. */
  payoff: ChartPayoff | null;
  /** A loan tracked in Actual: the periods before the tracking start are shaded, and today is marked. */
  tracking?: { firstPeriod: string; startPeriod: string; todayPeriod: string; /** Installments precede the tracking start, so the periods before it are shaded. */ untrackedBefore: boolean } | null;
};

/**
 * Adds a tracked loan's own balance in Actual ("Balance in Actual", the last value in each period) and the tracking
 * markers to chart data built by `chartSeries`.
 */
export function withTracking(data: ChartData, tracked: { startDate: string; today: string; actual: readonly { date: string; owedMinor: number }[]; installmentsBefore?: number; anchor?: { date: string } }, view: "month" | "year"): ChartData {
  const keyOf = (date: string) => (view === "month" ? date.slice(0, 7) : date.slice(0, 4));
  const byPeriod = new Map(data.points.map((p) => [p.period, { ...p }]));
  for (const a of tracked.actual) {
    const period = keyOf(a.date);
    const point = byPeriod.get(period) ?? { period };
    point.actualBalance = a.owedMinor;
    byPeriod.set(period, point);
  }
  const points = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
  // Before the tracking start the figures are the contract's; up to the last real event they are Actual's; after it, the projection.
  for (const point of points) point.source = point.period < keyOf(tracked.startDate) ? "contract" : tracked.anchor && point.period > keyOf(tracked.anchor.date) ? "projected" : "actual";
  const series: SeriesId[] = tracked.actual.length ? [data.series[0] ?? "balance", "actualBalance", ...data.series.slice(1)] : data.series;
  return { ...data, points, series: [...new Set(series)], tracking: points.length ? { firstPeriod: points[0].period, startPeriod: keyOf(tracked.startDate), todayPeriod: keyOf(tracked.today), untrackedBefore: (tracked.installmentsBefore ?? 0) > 0 } : null };
}

/**
 * Chart series per month or year. The balance and comparison come from the
 * engine; the interest-bearing balance from its diagnostics; and the offset
 * balance from projection v2's authoritative state points. A series whose
 * values are all zero is dropped.
 */
export function chartSeries(projection: DebtProjection, sim: SimulationState, options: { view: "month" | "year"; comparison?: DebtProjection | null }): ChartData {
  if (!projection.ok) return { points: [], series: [], rateChanges: [], payoff: null };
  const keyOf = (date: string) => (options.view === "month" ? date.slice(0, 7) : date.slice(0, 4));
  const byPeriod = new Map<string, ChartPoint>();
  const projectionPeriods = new Set<string>();
  let cumulative = 0;
  let installments = 0;
  for (const e of projection.events) {
    const period = keyOf(e.date);
    projectionPeriods.add(period);
    const point = byPeriod.get(period) ?? { period };
    if (e.eventType === "repayment" || e.eventType === "final-payment") {
      installments++;
      point.paymentMinor = (point.paymentMinor ?? 0) - e.cashMovementMinor;
      point.paymentInterestMinor = (point.paymentInterestMinor ?? 0) + e.interestMinor;
    }
    if (e.eventType === "extra-repayment") point.extraMinor = (point.extraMinor ?? 0) - e.cashMovementMinor;
    if (installments > 0) point.installment = installments;
    cumulative += e.interestMinor;
    point.balance = e.balanceAfterMinor;
    point.cumulativeInterest = cumulative;
    if (typeof e.diagnostics.interestBearingMinor === "number") point.interestBearing = e.diagnostics.interestBearingMinor;
    byPeriod.set(period, point);
  }
  for (const state of projection.offsetStates) {
    const period = keyOf(state.date);
    const point = byPeriod.get(period) ?? { period };
    point.offsetBalance = state.totalBalanceMinor;
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(sim.startDate)) for (const point of points) point.elapsedMonths = monthsElapsed(sim.startDate, point.period);
  const opening = sim.principalMinor;
  if (opening && opening > 0) for (const point of points) if (point.balance !== undefined) point.repaidPercent = Math.min(100, Math.max(0, Math.round((1 - point.balance / opening) * 100)));
  let offsetBalance: number | undefined;
  for (const point of points) {
    if (point.offsetBalance !== undefined) offsetBalance = point.offsetBalance;
    else if (offsetBalance !== undefined) point.offsetBalance = offsetBalance;
  }
  const candidates: SeriesId[] = ["balance", ...(options.comparison?.ok ? (["comparison"] as const) : []), "offsetBalance", "interestBearing", "cumulativeInterest"];
  const series = candidates.filter((id) => points.some((p) => (p[id] ?? 0) !== 0));
  const rateChangesByPeriod = new Map<string, ChartRateChange[]>();
  for (const rate of sim.rates.slice(1).sort((a, b) => a.accrualEffectiveFrom.localeCompare(b.accrualEffectiveFrom))) {
    if (rate.annualRateDecimal === null) continue;
    const period = keyOf(rate.accrualEffectiveFrom);
    if (!projectionPeriods.has(period)) continue;
    const changes = rateChangesByPeriod.get(period) ?? [];
    changes.push({ date: rate.accrualEffectiveFrom, annualRateDecimal: rate.annualRateDecimal });
    rateChangesByPeriod.set(period, changes);
  }
  let payoffEvent: DebtProjectionEvent | undefined;
  if (projection.events.at(-1)?.balanceAfterMinor === 0) {
    for (let index = projection.events.length - 1; index >= 0; index -= 1) {
      const event = projection.events[index];
      if (event.balanceBeforeMinor > 0 && event.balanceAfterMinor === 0 && event.eventType !== "interest-charge") {
        payoffEvent = event;
        break;
      }
    }
  }
  return {
    points,
    series,
    rateChanges: [...rateChangesByPeriod].map(([period, changes]) => ({ period, changes })),
    payoff: payoffEvent ? { period: keyOf(payoffEvent.date), date: payoffEvent.date } : null,
  };
}
