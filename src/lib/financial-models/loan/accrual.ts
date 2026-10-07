import type { IsoDate } from "../calendar/dates";
import { add, div, max, mul, sub, WORKING_SCALE, DEC_ZERO, type Dec } from "../money/kernel";
import type { RoundingMode } from "../money/rounding";
import type { DayCountConvention } from "./daycount/types";
import type { AccrualMethod, CalculationProfile } from "./profile";

/**
 * Daily interest accrual (FR-039, V3 §10.4 and §10.14).
 *
 * Accrual, charging and capitalization are separate. Interest accrues day by
 * day into an accrued-but-uncharged amount; charging moves it into the debt
 * (./charge.ts). Whether the accrued amount itself bears interest depends on
 * the method, and the two methods never share the label "daily":
 *
 * - `daily-simple`: the day's base is the debt net of offsets only. Accrued,
 *   uncharged interest earns nothing until it is charged.
 * - `daily-compounded`: accrued interest joins the base every day (daily
 *   capitalization).
 */

export const ACCRUAL_VERSION = "accrual@1";

/** Decimal places a day's interest is held to before it is added (FR-046 intermediate scale). */
export function intermediateScale(profile: CalculationProfile, minorDigits: number): number {
  const s = profile.rounding.intermediateScale;
  return s.mode === "full" ? WORKING_SCALE : s.mode === "currency" ? minorDigits : s.places;
}

/**
 * One day's interest: `base × annualRate ÷ denominator(date)`, rounded to the
 * intermediate scale by the intermediate rounding mode. `base` is never
 * negative (an offset larger than the debt leaves nothing to charge).
 */
export function dayInterest(
  base: Dec,
  annualRate: Dec,
  convention: DayCountConvention,
  date: IsoDate,
  scale: number,
  mode: RoundingMode
): Dec {
  const positiveBase = max(base, DEC_ZERO);
  return div(mul(positiveBase, annualRate), { int: BigInt(convention.dailyDenominator(date)), scale: 0 }, scale, mode);
}

/**
 * The base a day's interest is charged on.
 *
 * @param debt the charged debt (principal plus charged interest and fees)
 * @param eligibleOffset the day's total eligible offset (./offsets.ts)
 * @param accrued interest accrued but not yet charged
 */
export function interestBase(method: AccrualMethod, debt: Dec, eligibleOffset: Dec, accrued: Dec): Dec {
  const net = max(sub(debt, eligibleOffset), DEC_ZERO);
  return method === "daily-compounded" ? add(net, accrued) : net;
}
