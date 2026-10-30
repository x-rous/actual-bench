import type { DebtProjection, DebtProjectionEvent } from "@/lib/financial-models/loan/projection";
import type { ComponentKind } from "@/lib/financial-models/loan/model";
import { simulationToModel, type SimulationState } from "./simulatorModel";
import { addDays } from "@/lib/financial-models/calendar/dates";
import { eligibleOffset, linkInForce } from "@/lib/financial-models/loan/offsets";
import { interestBase } from "@/lib/financial-models/loan/accrual";
import { DEC_ZERO, fromMinor, toMinor } from "@/lib/financial-models/money/kernel";

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

export type SeriesId = "balance" | "actualBalance" | "comparison" | "baseline" | "offsetBalance" | "interestBearing" | "cumulativeInterest";
export type ChartSource = "contract" | "actual" | "projected";
/** `installment`: scheduled repayments up to this period; `elapsedMonths`: whole months to the latest event or period end. */
export type ChartPoint = {
  period: string;
  openingDate?: string;
  date?: string;
  balanceDate?: string;
  sources?: ChartSource[];
  events?: { date: string; type: DebtProjectionEvent["eventType"] | "payment-change" | "offset-change" }[];
  installment?: number;
  elapsedMonths?: number;
  /** Change in balance relative to opening principal, as a whole percentage. */
  repaidPercent?: number;
  /** Cash paid by scheduled and final repayments in the period (minor units), and the interest charged with them. */
  paymentMinor?: number;
  paymentInterestMinor?: number;
  /** Cash repayment allocation by component, in minor units; null when a payment lacks a reliable split. */
  paymentBreakdown?: Partial<Record<ComponentKind, number>> | null;
  cashFeesMinor?: number;
  capitalizedFeesMinor?: number;
  /** Interest charged by all events in this period (minor units). */
  periodInterestMinor?: number;
  /** Extra repayments in the period (minor units). */
  extraMinor?: number;
  /** The period holds an event that really happened (a payment in Actual), even if it falls before the tracking start month. */
  fromActual?: boolean;
  /** A tracked loan: where the period's figures come from. */
  source?: "contract" | "actual" | "projected";
} & Partial<Record<SeriesId, number>>;

/** Whole months from `start` to a date, or the end of a month or year. */
export function monthsElapsed(start: string, period: string): number {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const year = Number(period.slice(0, 4));
  const month = period.length > 4 ? Number(period.slice(5, 7)) : 12;
  const lastDay = period.length === 10 ? Number(period.slice(8, 10)) : new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.max(0, (year - startYear) * 12 + (month - startMonth) - (lastDay < startDay ? 1 : 0));
}
export type ChartRateChange = { date: string; annualRateDecimal: string };
export type ChartRateChangeGroup = { period: string; changes: ChartRateChange[] };
export type ChartPayoff = { period: string; date: string; recorded?: boolean };
export type ChartData = {
  points: ChartPoint[];
  series: SeriesId[];
  /** Contract rate changes after the opening rate, grouped at the chart's current resolution. */
  rateChanges: ChartRateChangeGroup[];
  /** The final event that settles the projected debt, provided the projection closes at zero. */
  payoff: ChartPayoff | null;
  /** A loan tracked in Actual: the periods before the tracking start are shaded, and today is marked. */
  tracking?: { firstPeriod: string; startPeriod: string; todayPeriod: string; startDate?: string; todayDate?: string; /** Installments precede the tracking start, so the periods before it are shaded. */ untrackedBefore: boolean } | null;
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
    if (!point.date || a.date > point.date) point.date = a.date;
    point.fromActual = true;
    if (point.sources) point.sources = [...new Set([...point.sources, "actual" as const])];
    byPeriod.set(period, point);
  }
  const points = [...byPeriod.values()].sort((a, b) => a.openingDate ? -1 : b.openingDate ? 1 : a.period.localeCompare(b.period));
  // Before the tracking start the figures are the contract's; up to the last real event they are Actual's; after it, the projection.
  // A period that holds something that really happened is Actual's, even before the start month: the start installment
  // may have been paid in the month before it was due. A loan tracked from its first installment has no contract part.
  const hasContractPart = tracked.installmentsBefore === undefined || tracked.installmentsBefore > 0;
  for (const point of points) {
    if (point.openingDate) continue;
    if (point.sources?.length) continue;
    point.source = hasContractPart && !point.fromActual && point.period < keyOf(tracked.startDate) ? "contract" : tracked.anchor && point.period > keyOf(tracked.anchor.date) ? "projected" : "actual";
  }
  const series: SeriesId[] = tracked.actual.length ? [data.series[0] ?? "balance", "actualBalance", ...data.series.slice(1)] : data.series;
  const firstPeriod = points.find((point) => !point.openingDate)?.period;
  return { ...data, points, series: [...new Set(series)], tracking: firstPeriod ? { firstPeriod, startPeriod: keyOf(tracked.startDate), todayPeriod: keyOf(tracked.today), startDate: tracked.startDate, todayDate: tracked.today, untrackedBefore: (tracked.installmentsBefore ?? 0) > 0 } : null };
}

/**
 * Chart series per month or year. The balance and comparison come from the
 * engine; the interest-bearing balance from its diagnostics; and the offset
 * balance from projection v2's authoritative state points. A series whose
 * values are all zero is dropped.
 */
export function chartSeries(projection: DebtProjection, sim: SimulationState, options: { view: "month" | "year"; comparison?: DebtProjection | null; baseline?: DebtProjection | null; trackedAnchor?: { date: string; restartDate: string } }): ChartData {
  if (!projection.ok) return { points: [], series: [], rateChanges: [], payoff: null };
  const keyOf = (date: string) => (options.view === "month" ? date.slice(0, 7) : date.slice(0, 4));
  const byPeriod = new Map<string, ChartPoint>();
  let cumulative = 0;
  let installments = 0;
  for (const e of projection.events) {
    const period = keyOf(e.date);
    const point = byPeriod.get(period) ?? { period };
    if (!point.date || e.date > point.date) point.date = e.date;
    const source = e.diagnostics.chartSource;
    if (source === "contract" || source === "actual" || source === "projected") point.sources = [...new Set<ChartSource>([...(point.sources ?? []), source])];
    if (["extra-repayment", "draw", "fee", "recast"].includes(e.eventType)) (point.events ??= []).push({ date: e.date, type: e.eventType });
    if (e.eventType === "repayment" || e.eventType === "final-payment") {
      installments++;
      point.paymentMinor = (point.paymentMinor ?? 0) - e.cashMovementMinor;
      point.paymentInterestMinor = (point.paymentInterestMinor ?? 0) + e.interestMinor;
      if (point.paymentBreakdown !== null) {
        if (!e.lines || e.lines.reduce((sum, line) => sum + line.amountMinor, 0) !== -e.cashMovementMinor) point.paymentBreakdown = null;
        else {
          const breakdown = point.paymentBreakdown ?? {};
          for (const line of e.lines) breakdown[line.kind] = (breakdown[line.kind] ?? 0) + line.amountMinor;
          point.paymentBreakdown = breakdown;
        }
      }
    }
    if (e.eventType === "fee" && e.feesMinor) {
      if (e.cashMovementMinor < 0) point.cashFeesMinor = (point.cashFeesMinor ?? 0) + e.feesMinor;
      else if (e.principalMovementMinor > 0) point.capitalizedFeesMinor = (point.capitalizedFeesMinor ?? 0) + e.feesMinor;
    }
    if (e.eventType === "extra-repayment") point.extraMinor = (point.extraMinor ?? 0) - e.cashMovementMinor;
    if (installments > 0) point.installment = installments;
    if (e.diagnostics.fromActual === true) point.fromActual = true;
    cumulative += e.interestMinor;
    point.periodInterestMinor = (point.periodInterestMinor ?? 0) + e.interestMinor;
    point.balance = e.balanceAfterMinor;
    point.balanceDate = e.date;
    point.cumulativeInterest = cumulative;
    if (typeof e.diagnostics.interestBearingMinor === "number") point.interestBearing = e.diagnostics.interestBearingMinor;
    byPeriod.set(period, point);
  }
  for (const state of projection.offsetStates) {
    if (state.date <= sim.startDate) continue;
    const period = keyOf(state.date);
    const point = byPeriod.get(period) ?? { period };
    if (!point.date || state.date > point.date) point.date = state.date;
    point.offsetBalance = state.totalBalanceMinor;
    if (state.date > sim.startDate && !point.events?.some((event) => event.date === state.date && event.type === "offset-change")) (point.events ??= []).push({ date: state.date, type: "offset-change" });
    byPeriod.set(period, point);
  }
  if (options.comparison?.ok) {
    for (const e of options.comparison.events) {
      const period = keyOf(e.date);
      const point = byPeriod.get(period) ?? { period };
      if (!point.date || e.date > point.date) point.date = e.date;
      point.comparison = e.balanceAfterMinor;
      byPeriod.set(period, point);
    }
  }
  if (options.baseline?.ok) {
    for (const e of options.baseline.events) {
      const period = keyOf(e.date);
      const point = byPeriod.get(period) ?? { period };
      if (!point.date || e.date > point.date) point.date = e.date;
      point.baseline = e.balanceAfterMinor;
      byPeriod.set(period, point);
    }
  }
  for (const assumption of sim.assumptions) {
    if (assumption.kind !== "payment-change" || assumption.enabled === false || (options.trackedAnchor && assumption.effectiveFrom <= options.trackedAnchor.date)) continue;
    const date = options.trackedAnchor && assumption.effectiveFrom <= options.trackedAnchor.restartDate ? addDays(options.trackedAnchor.restartDate, 1) : assumption.effectiveFrom;
    if (!projection.events[0] || date < projection.events[0].date || date > projection.events.at(-1)!.date) continue;
    const period = keyOf(date);
    const point = byPeriod.get(period) ?? { period };
    if (!point.date || date > point.date) point.date = date;
    (point.events ??= []).push({ date, type: "payment-change" });
    byPeriod.set(period, point);
  }
  const rateChangesByPeriod = new Map<string, ChartRateChange[]>();
  const firstPeriod = projection.events[0] && keyOf(projection.events[0].date);
  const lastPeriod = projection.events.at(-1) && keyOf(projection.events.at(-1)!.date);
  for (const rate of sim.rates.slice(1).sort((a, b) => a.accrualEffectiveFrom.localeCompare(b.accrualEffectiveFrom))) {
    if (rate.annualRateDecimal === null) continue;
    const period = keyOf(rate.accrualEffectiveFrom);
    if (!firstPeriod || !lastPeriod || period < firstPeriod || period > lastPeriod) continue;
    const changes = rateChangesByPeriod.get(period) ?? [];
    changes.push({ date: rate.accrualEffectiveFrom, annualRateDecimal: rate.annualRateDecimal });
    rateChangesByPeriod.set(period, changes);
    if (!byPeriod.has(period)) byPeriod.set(period, { period });
  }
  const firstEvent = projection.events[0];
  if (firstEvent && sim.startDate && sim.principalMinor !== null) {
    const opening: ChartPoint = { period: `opening:${sim.startDate}`, openingDate: sim.startDate, date: sim.startDate, balance: sim.principalMinor, balanceDate: sim.startDate, cumulativeInterest: 0, elapsedMonths: 0, repaidPercent: 0 };
    const openingOffsets = projection.offsetStates.filter((state) => state.date <= sim.startDate);
    if (openingOffsets.length) {
      opening.offsetBalance = openingOffsets.at(-1)!.totalBalanceMinor;
      const built = simulationToModel(sim);
      if (built.ok) {
        const balances = new Map(openingOffsets.map((state) => [state.accountId, { balanceMinor: state.balanceMinor, clearedBalanceMinor: state.clearedBalanceMinor }]));
        const active = built.model.offsets.filter((link) => linkInForce(link, sim.startDate));
        if (active.length && active.every((link) => balances.has(link.accountId))) {
          const eligible = eligibleOffset(active, balances, sim.startDate, sim.minorDigits);
          opening.interestBearing = toMinor(interestBase(sim.profile.accrual, fromMinor(sim.principalMinor, sim.minorDigits), eligible, DEC_ZERO), sim.minorDigits, "down");
        }
      }
    }
    if (options.comparison?.ok && options.comparison.events[0]?.date === firstEvent.date) opening.comparison = options.comparison.events[0].balanceBeforeMinor;
    if (options.baseline?.ok && options.baseline.events[0]?.date === firstEvent.date) opening.baseline = options.baseline.events[0].balanceBeforeMinor;
    byPeriod.set(opening.period, opening);
  }
  const points = [...byPeriod.values()].sort((a, b) => a.openingDate ? -1 : b.openingDate ? 1 : a.period.localeCompare(b.period));
  if (/^\d{4}-\d{2}-\d{2}$/.test(sim.startDate)) for (const point of points) if (!point.openingDate) point.elapsedMonths = monthsElapsed(sim.startDate, point.balanceDate ?? point.period);
  const opening = sim.principalMinor;
  if (opening && opening > 0) for (const point of points) if (point.balance !== undefined) point.repaidPercent = Math.round((1 - point.balance / opening) * 1000) / 10;
  let offsetBalance: number | undefined;
  for (const point of points) {
    if (point.offsetBalance !== undefined) offsetBalance = point.offsetBalance;
    else if (offsetBalance !== undefined) point.offsetBalance = offsetBalance;
  }
  const candidates: SeriesId[] = ["balance", ...(options.comparison?.ok ? (["comparison"] as const) : []), ...(options.baseline?.ok && points.some((p) => p.baseline !== undefined && p.balance !== undefined && p.baseline !== p.balance) ? (["baseline"] as const) : []), "offsetBalance", "interestBearing", "cumulativeInterest"];
  const series = candidates.filter((id) => points.some((p) => (p[id] ?? 0) !== 0));
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
    payoff: payoffEvent ? { period: keyOf(payoffEvent.date), date: payoffEvent.date, recorded: payoffEvent.diagnostics.fromActual === true } : null,
  };
}
