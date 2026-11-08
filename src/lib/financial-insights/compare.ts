import { computeFlows, receivedOf, spentOf, type Ledger } from "./measures";
import { addMonths, resolvePeriod, type ResolvedPeriod } from "./period";

/** Money in, money out and what was kept over a run of whole months. */
export type FlowTotals = { received: number; spent: number; kept: number };

/**
 * The period against the stretch of the same length just before it. Only whole months are compared: a month still running is
 * left out of both sides, so a part month is never set against a full one. It exists only when the budget has data back to the
 * start of the earlier stretch, never against a stretch that is partly before the budget began.
 */
export type Comparison = {
  /** How many months each side holds. */
  months: number;
  current: FlowTotals;
  previous: FlowTotals;
  /** "the previous month", "the 10 months before". */
  label: string;
};

function totalsOver(ledger: Ledger, period: ResolvedPeriod): FlowTotals {
  const { flows } = computeFlows(ledger, period);
  const received = receivedOf(flows);
  const spent = spentOf(flows);
  return { received, spent, kept: received - spent };
}

export function comparePeriods(ledger: Ledger, period: ResolvedPeriod, today: string): Comparison | null {
  const whole = period.partial ? period.months.slice(0, -1) : period.months;
  if (whole.length === 0 || ledger.firstMonth === null) return null;
  const previousStart = addMonths(whole[0], -whole.length);
  if (ledger.firstMonth > previousStart) return null;
  const window = (startMonth: string, endMonth: string) => resolvePeriod({ kind: "custom", startMonth, endMonth }, today, ledger.firstMonth);
  return {
    months: whole.length,
    current: totalsOver(ledger, window(whole[0], whole[whole.length - 1])),
    previous: totalsOver(ledger, window(previousStart, addMonths(whole[0], -1))),
    label: whole.length === 1 ? "the previous month" : `the ${whole.length} months before`,
  };
}

/** The change from `before` to `now` in percent with one decimal, or null when there was nothing to compare with. */
export function percentChange(now: number, before: number): number | null {
  return before === 0 ? null : Math.round(((now - before) * 1000) / Math.abs(before)) / 10;
}
