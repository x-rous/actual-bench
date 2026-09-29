import { addMonths, parseIsoDate, type IsoDate } from "../calendar/dates";
import { generateSchedule } from "../calendar/schedule";
import type { LoanModelSnapshot } from "./model";

/**
 * When interest is charged (FR-039, FR-014, V3 §10.4).
 *
 * The charge cadence is independent of the repayment cadence. A loan that
 * charges monthly and is repaid fortnightly is charged once a month, never at
 * each repayment. Charge dates keep their day of month and clamp in short
 * months (FR-049), so a charge day of 31 falls on 29 February and 30 April.
 *
 * `at-repayment` has no calendar of its own: the engines charge on each
 * repayment date instead.
 */

export const CHARGE_VERSION = "charge@1";

/** The first charge date: configured, else one charge period after the opening date. */
export function firstChargeDate(model: LoanModelSnapshot): IsoDate {
  const { terms, profile } = model;
  if (terms.firstInterestChargeDate) return terms.firstInterestChargeDate;
  const months = profile.chargeFrequency === "quarterly" ? 3 : profile.chargeFrequency === "annual" ? 12 : 1;
  return addMonths(terms.openingDate, months, profile.chargeDay ?? parseIsoDate(terms.openingDate).day);
}

/** Charge dates in [from, to], or null for `at-repayment` (charged with each repayment). */
export function chargeDates(model: LoanModelSnapshot, from: IsoDate, to: IsoDate): IsoDate[] | null {
  const { profile } = model;
  if (profile.chargeFrequency === "at-repayment") return null;
  const first = firstChargeDate(model);
  const frequency = profile.chargeFrequency === "monthly" ? "monthly" : profile.chargeFrequency === "quarterly" ? "quarterly" : "annual";
  return generateSchedule(
    { frequency, firstDate: first, anchorDay: profile.chargeDay ?? undefined, shortMonthPolicy: profile.shortMonth },
    { from, to }
  );
}
