import { add, round, sub, toMinor, DEC_ZERO, type Dec } from "../money/kernel";
import type { CalculationProfile } from "./profile";

/**
 * Posting precision (FR-046, FR-155, owner decision 2026-09-29).
 *
 * Every charged or paid amount is a whole number of minor units; the engine
 * never pretends a fraction of a cent was posted. What happens to the part
 * below the minor unit depends on `balancePrecision`:
 *
 * - `round-each-posting`: the charge is rounded by `interestPostingRounding`
 *   and the remainder is dropped (reported, never carried).
 * - `round-each-event`: as above, and in addition a day's interest is rounded
 *   to the minor unit as it accrues (`accrualScaleFor`), so compounding works
 *   on posted amounts.
 * - `carry-full-precision`: the remainder is carried, exactly, into the next
 *   charge, so over time nothing is lost or gained.
 */

export const DAILY_PRECISION_VERSION = "daily-precision@1";

export type PostedCharge = {
  chargedMinor: number;
  /** Remainder carried to the next charge (zero unless `carry-full-precision`). */
  carry: Dec;
  /** Sub-minor difference dropped by rounding (zero under `carry-full-precision`). */
  dropped: Dec;
};

export function postCharge(accrued: Dec, carry: Dec, profile: CalculationProfile, minorDigits: number): PostedCharge {
  const mode = profile.rounding.interestPostingRounding;
  if (profile.rounding.balancePrecision === "carry-full-precision") {
    const total = add(accrued, carry);
    const posted = round(total, minorDigits, mode);
    return { chargedMinor: toMinor(posted, minorDigits, "down"), carry: sub(total, posted), dropped: DEC_ZERO };
  }
  const posted = round(accrued, minorDigits, mode);
  return { chargedMinor: toMinor(posted, minorDigits, "down"), carry: DEC_ZERO, dropped: sub(accrued, posted) };
}

/** The scale a day's interest is rounded to under `round-each-event` (the minor unit), else null. */
export function eventRoundingScale(profile: CalculationProfile, minorDigits: number): number | null {
  return profile.rounding.balancePrecision === "round-each-event" ? minorDigits : null;
}
