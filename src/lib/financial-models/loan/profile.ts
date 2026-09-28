import { WORKING_SCALE } from "../money/kernel";
import type { RoundingMode } from "../money/rounding";
import type { ShortMonthPolicy } from "../calendar/dates";
import type { ScheduleFrequency } from "../calendar/schedule";
import type { DayCountId } from "./daycount/types";
import type { EventOrderProfile } from "./events";
import type { RateQuote } from "./rates";
import type { RepaymentDerivation } from "./repayment";

/**
 * The calculation profile (FR-035, V3 §10): every axis of how a lender
 * calculates, stored separately and never inferred from another. Contractual
 * term, amortization term and maturity live in the config's `terms`.
 *
 * Axes are independent, but some combinations contradict each other. Those
 * are refused as `inconsistent-profile` (Blocked), naming the axes that
 * conflict, rather than silently picking one reading.
 */

export const PROFILE_VERSION = "profile@1";

export type AmortizationMethod = "level-payment" | "constant-principal" | "interest-only-phase" | "custom-payment" | "revolving";
export const AMORTIZATION_METHODS: readonly AmortizationMethod[] = [
  "level-payment",
  "constant-principal",
  "interest-only-phase",
  "custom-payment",
  "revolving",
];

/** FR-039: accrual, charging and capitalization are distinct; "daily" alone is never a value. */
export type AccrualMethod = "per-period" | "daily-simple" | "daily-compounded";
export const ACCRUAL_METHODS: readonly AccrualMethod[] = ["per-period", "daily-simple", "daily-compounded"];

/** When accrued interest is charged (posted) to the loan. */
export type ChargeFrequency = "monthly" | "quarterly" | "annual" | "at-repayment";
export const CHARGE_FREQUENCIES: readonly ChargeFrequency[] = ["monthly", "quarterly", "annual", "at-repayment"];

/** When accrued interest starts bearing interest itself. */
export type Capitalization = "at-charge" | "daily";
export const CAPITALIZATIONS: readonly Capitalization[] = ["at-charge", "daily"];

export type RecastPolicy = "never" | "on-rate-change" | "annual" | "on-contract-date" | "lender-provided";
export const RECAST_POLICIES: readonly RecastPolicy[] = ["never", "on-rate-change", "annual", "on-contract-date", "lender-provided"];

/** When a new rate starts to accrue. */
export type RateEffectiveTiming = "on-accrual-effective-date" | "from-next-charge-period";
export const RATE_EFFECTIVE_TIMINGS: readonly RateEffectiveTiming[] = ["on-accrual-effective-date", "from-next-charge-period"];

/** When a repayment reduces the interest-bearing balance. */
export type RepaymentEffectiveTiming = "on-payment-date" | "next-day";
export const REPAYMENT_EFFECTIVE_TIMINGS: readonly RepaymentEffectiveTiming[] = ["on-payment-date", "next-day"];

export type FinalPaymentPolicy = "true-up-to-zero" | "contractual-balloon" | "keep-level-payment-with-residual" | "continue-until-paid";
export const FINAL_PAYMENT_POLICIES: readonly FinalPaymentPolicy[] = [
  "true-up-to-zero",
  "contractual-balloon",
  "keep-level-payment-with-residual",
  "continue-until-paid",
];

export type BalancePrecision = "round-each-event" | "round-each-posting" | "carry-full-precision";
export const BALANCE_PRECISIONS: readonly BalancePrecision[] = ["round-each-event", "round-each-posting", "carry-full-precision"];

/** FR-046: full precision, currency precision, or a fixed number of places. */
export type IntermediateScale = { mode: "full" } | { mode: "currency" } | { mode: "fixed"; places: number };

export type RoundingProfile = {
  paymentRounding: RoundingMode;
  interestPostingRounding: RoundingMode;
  intermediateScale: IntermediateScale;
  intermediateRounding: RoundingMode;
  balancePrecision: BalancePrecision;
};

export type CalculationProfile = {
  amortization: AmortizationMethod;
  rateQuote: RateQuote;
  dayCount: DayCountId;
  accrual: AccrualMethod;
  chargeFrequency: ChargeFrequency;
  /** Day of month interest is charged; null for `at-repayment` or when set by the first charge date. */
  chargeDay: number | null;
  capitalization: Capitalization;
  repaymentFrequency: ScheduleFrequency;
  repaymentDerivation: RepaymentDerivation;
  recast: RecastPolicy;
  rateEffectiveTiming: RateEffectiveTiming;
  repaymentEffectiveTiming: RepaymentEffectiveTiming;
  rounding: RoundingProfile;
  eventOrder: EventOrderProfile;
  finalPayment: FinalPaymentPolicy;
  shortMonth: ShortMonthPolicy;
  negativeAmortizationAllowed: boolean;
  presetId: string | null;
};

export type ProfileAxis = keyof CalculationProfile | `rounding.${keyof RoundingProfile}`;

export type ProfileConflict = { axes: ProfileAxis[]; message: string };

export type ProfileCheck = { ok: true } | { ok: false; code: "inconsistent-profile"; conflicts: ProfileConflict[] };

/**
 * The `profile@1` conflict table. Each rule names the axes it ties together
 * and the requirement it enforces.
 */
export function validateProfile(profile: CalculationProfile): ProfileCheck {
  const conflicts: ProfileConflict[] = [];
  const conflict = (axes: ProfileAxis[], message: string) => conflicts.push({ axes, message });
  const p = profile;

  // FR-041: pro-rata and split derivations convert a monthly payment to a weekly or fortnightly one.
  if ((p.repaymentDerivation === "monthly-equivalent-pro-rata" || p.repaymentDerivation === "split-monthly") &&
      p.repaymentFrequency !== "weekly" && p.repaymentFrequency !== "fortnightly") {
    conflict(["repaymentDerivation", "repaymentFrequency"], `${p.repaymentDerivation} converts a monthly payment, so repayments must be weekly or fortnightly.`);
  }

  // An annuity needs a fixed number of payments a year.
  if (p.repaymentDerivation === "annuity-at-payment-frequency" && p.repaymentFrequency === "custom-dated") {
    conflict(["repaymentDerivation", "repaymentFrequency"], "An annuity at the payment frequency needs a regular frequency, not custom dates.");
  }

  // FR-036: constant principal sets principal per period; an annuity payment contradicts it.
  if (p.amortization === "constant-principal" && p.repaymentDerivation === "annuity-at-payment-frequency") {
    conflict(["amortization", "repaymentDerivation"], "Constant principal pays principal ÷ periods plus interest, not a level annuity.");
  }

  // FR-039: simple accrual only bears interest once charged; compounding capitalizes daily.
  if (p.accrual === "daily-simple" && p.capitalization === "daily") {
    conflict(["accrual", "capitalization"], "Daily simple accrual must not bear interest until charged; daily capitalization would compound it.");
  }
  if (p.accrual === "daily-compounded" && p.capitalization !== "daily") {
    conflict(["accrual", "capitalization"], "Daily compounding needs daily capitalization.");
  }
  if (p.accrual === "per-period" && p.capitalization === "daily") {
    conflict(["accrual", "capitalization"], "Per-period accrual has no daily interest to capitalize.");
  }

  // FR-038: the monthly allocation convention is defined per calendar month.
  if (p.dayCount === "monthly-30-360-actual-day-allocation" && p.chargeFrequency !== "monthly") {
    conflict(["dayCount", "chargeFrequency"], "Monthly 30/360 actual-day allocation spreads each month's interest, so interest must be charged monthly.");
  }

  // 30/360 counts are not additive day by day, so they cannot drive a daily accrual.
  if (p.dayCount === "30u-360" && p.accrual !== "per-period") {
    conflict(["dayCount", "accrual"], "30/360 day counting cannot be accrued day by day.");
  }

  if (p.chargeFrequency === "at-repayment" && p.chargeDay !== null) {
    conflict(["chargeFrequency", "chargeDay"], "Interest charged at each repayment has no separate charge day.");
  }
  if (p.chargeDay !== null && !(Number.isInteger(p.chargeDay) && p.chargeDay >= 1 && p.chargeDay <= 31)) {
    conflict(["chargeDay"], "The charge day must be a day of the month from 1 to 31.");
  }

  const scale = p.rounding.intermediateScale;
  if (scale.mode === "fixed" && !(Number.isInteger(scale.places) && scale.places >= 0 && scale.places <= WORKING_SCALE)) {
    conflict(["rounding.intermediateScale"], `A fixed intermediate scale must be 0 to ${WORKING_SCALE} places.`);
  }

  return conflicts.length === 0 ? { ok: true } : { ok: false, code: "inconsistent-profile", conflicts };
}
