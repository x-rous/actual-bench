import { compareDates, type IsoDate } from "../../calendar/dates";
import { div, mul, WORKING_SCALE, type Dec } from "../../money/kernel";
import type { RoundingMode } from "../../money/rounding";
import type { ComponentVersion } from "../versions";

/**
 * Day-count conventions (FR-038, V3 §10.3).
 *
 * A convention answers one question: what share of a year does the period
 * from `start` (inclusive) to `end` (exclusive) count as? It answers with
 * segments of whole days over an integer denominator, so the share is an
 * exact fraction and a calculation can round exactly once, where its profile
 * says to. Day count is independent of how the rate is quoted (FR-037).
 */

export type DayCountId =
  | "actual-365-fixed"
  | "actual-actual-calendar"
  | "actual-360"
  | "monthly-30-360-actual-day-allocation"
  | "30u-360";

export const DAY_COUNT_IDS: readonly DayCountId[] = [
  "actual-365-fixed",
  "actual-actual-calendar",
  "actual-360",
  "monthly-30-360-actual-day-allocation",
  "30u-360",
];

/** `days / denominator` of a year, for the days in [from, to). */
export type DayCountSegment = { from: IsoDate; to: IsoDate; days: number; denominator: number };

export type DayCountConvention = {
  id: DayCountId;
  version: ComponentVersion;
  /** Segments covering [start, end); empty when start equals end. */
  segments(start: IsoDate, end: IsoDate): DayCountSegment[];
  /** Denominator for a single day's accrual (the daily engine's view). */
  dailyDenominator(date: IsoDate): number;
};

export function assertPeriod(start: IsoDate, end: IsoDate): void {
  if (compareDates(start, end) > 0) throw new RangeError(`Period ends before it starts: ${start} to ${end}`);
}

/** The year fraction as an exact fraction `numerator / denominator`. */
export function yearFractionExact(convention: DayCountConvention, start: IsoDate, end: IsoDate): { numerator: bigint; denominator: bigint } {
  let numerator = BigInt(0);
  let denominator = BigInt(1);
  for (const s of convention.segments(start, end)) {
    // a/b + c/d = (a·d + c·b) / (b·d), reduced so long periods stay small.
    numerator = numerator * BigInt(s.denominator) + BigInt(s.days) * denominator;
    denominator = denominator * BigInt(s.denominator);
    const g = gcd(numerator, denominator);
    if (g > BigInt(1)) {
      numerator /= g;
      denominator /= g;
    }
  }
  return { numerator, denominator };
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < BigInt(0) ? -a : a;
  let y = b;
  while (y !== BigInt(0)) [x, y] = [y, x % y];
  return x;
}

/** The year fraction to `scale` places, rounded once. */
export function yearFraction(
  convention: DayCountConvention,
  start: IsoDate,
  end: IsoDate,
  scale: number = WORKING_SCALE,
  mode: RoundingMode = "half-even"
): Dec {
  const { numerator, denominator } = yearFractionExact(convention, start, end);
  return div({ int: numerator, scale: 0 }, { int: denominator, scale: 0 }, scale, mode);
}

/**
 * Simple interest `principal × annualRate × yearFraction` for one period,
 * computed exactly and rounded once to `scale` places. Pass the currency's
 * minor digits as `scale` to round straight to a posted amount.
 */
export function periodInterest(
  principal: Dec,
  annualRate: Dec,
  convention: DayCountConvention,
  start: IsoDate,
  end: IsoDate,
  scale: number,
  mode: RoundingMode
): Dec {
  const { numerator, denominator } = yearFractionExact(convention, start, end);
  return div(mul(mul(principal, annualRate), { int: numerator, scale: 0 }), { int: denominator, scale: 0 }, scale, mode);
}
