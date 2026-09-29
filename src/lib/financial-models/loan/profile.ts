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
 * Axes are independent. Two separate checks guard combinations, and neither
 * treats "not built yet" as "impossible":
 *
 * - `validateProfile`: combinations that contradict their own definitions
 *   (mathematically or contractually invalid). Refused as
 *   `inconsistent-profile`, naming the axes.
 * - `checkProfileSupport`: well-defined combinations this build does not
 *   implement. Refused as `unsupported-config`, like an unknown identifier.
 *
 * Conventions without verified reference evidence are gated separately, by
 * the day-count registry (daycount/registry.ts), not here.
 */

export const PROFILE_VERSION = "profile@1";

/**
 * Interest-only is not a method: it is a phase (config `phases`), including a
 * whole-term interest-only loan (one phase plus `contractual-balloon`).
 */
export type AmortizationMethod = "level-payment" | "constant-principal" | "custom-payment" | "revolving";
export const AMORTIZATION_METHODS: readonly AmortizationMethod[] = [
  "level-payment",
  "constant-principal",
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

/**
 * The value date a repayment takes effect on, before same-day ordering
 * applies: the transaction's own date, or the next calendar day. Where in the
 * day an event falls (before or after the accrual) is `eventOrder`'s job, not
 * this axis. Business-day calendars are not modelled.
 */
export type RepaymentEffectiveTiming = "transaction-date" | "next-calendar-day";
export const REPAYMENT_EFFECTIVE_TIMINGS: readonly RepaymentEffectiveTiming[] = ["transaction-date", "next-calendar-day"];

export type FinalPaymentPolicy = "true-up-to-zero" | "contractual-balloon" | "keep-level-payment-with-residual" | "continue-until-paid";
export const FINAL_PAYMENT_POLICIES: readonly FinalPaymentPolicy[] = [
  "true-up-to-zero",
  "contractual-balloon",
  "keep-level-payment-with-residual",
  "continue-until-paid",
];

/**
 * What an interest-only repayment pays when interest is charged on its own
 * cadence (with interest charged at each repayment the two agree):
 *
 * - `charged-interest-outstanding`: the interest charged to the loan since the
 *   previous scheduled repayment (nothing before the first charge; one
 *   repayment per charge period pays it, later ones in the period pay nothing);
 *
 * It is not claimed as a lender rule. Paying interest accrued but not yet
 * charged is not offered: whether a lender holds it as prepaid interest or
 * charges it at the repayment is an open decision.
 */
export type InterestOnlyRepayment = "charged-interest-outstanding";
export const INTEREST_ONLY_REPAYMENTS: readonly InterestOnlyRepayment[] = ["charged-interest-outstanding"];

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
  interestOnlyRepayment: InterestOnlyRepayment;
  presetId: string | null;
};

export type ProfileAxis = keyof CalculationProfile | `rounding.${keyof RoundingProfile}`;

export type ProfileConflict = { axes: ProfileAxis[]; message: string };

export type ProfileCheck = { ok: true } | { ok: false; code: "inconsistent-profile"; conflicts: ProfileConflict[] };

export type SupportCheck = { ok: true } | { ok: false; code: "unsupported-combination"; conflicts: ProfileConflict[] };

/**
 * Invalid combinations (`profile@1`): each contradicts the definition of one
 * of its axes, so no implementation could honor it.
 */
export function validateProfile(profile: CalculationProfile): ProfileCheck {
  const conflicts: ProfileConflict[] = [];
  const conflict = (axes: ProfileAxis[], message: string) => conflicts.push({ axes, message });
  const p = profile;

  // FR-041 defines pro-rata and split as converting a monthly payment into a more
  // frequent one; applied to a monthly or less frequent cadence they are undefined.
  if ((p.repaymentDerivation === "monthly-equivalent-pro-rata" || p.repaymentDerivation === "split-monthly") &&
      (p.repaymentFrequency === "monthly" || p.repaymentFrequency === "quarterly" || p.repaymentFrequency === "annual" || p.repaymentFrequency === "custom-dated")) {
    conflict(["repaymentDerivation", "repaymentFrequency"], `${p.repaymentDerivation} converts a monthly payment into a more frequent one; ${p.repaymentFrequency} repayments are not that.`);
  }

  // An annuity at the payment frequency needs a periodic rate and a payment count.
  if (p.repaymentDerivation === "annuity-at-payment-frequency" && p.repaymentFrequency === "custom-dated") {
    conflict(["repaymentDerivation", "repaymentFrequency"], "An annuity at the payment frequency needs a regular frequency, not custom dates.");
  }

  // FR-036: constant principal pays principal ÷ periods plus interest, which is not a level annuity.
  if (p.amortization === "constant-principal" && p.repaymentDerivation === "annuity-at-payment-frequency") {
    conflict(["amortization", "repaymentDerivation"], "Constant principal pays principal ÷ periods plus interest, not a level annuity.");
  }

  // FR-039: simple accrual bears no interest until charged; compounding capitalizes daily.
  if (p.accrual === "daily-simple" && p.capitalization === "daily") {
    conflict(["accrual", "capitalization"], "Daily simple accrual must not bear interest until charged; daily capitalization would compound it.");
  }
  if (p.accrual === "daily-compounded" && p.capitalization !== "daily") {
    conflict(["accrual", "capitalization"], "Daily compounding means capitalizing daily.");
  }
  if (p.accrual === "per-period" && p.capitalization === "daily") {
    conflict(["accrual", "capitalization"], "Per-period accrual has no daily interest to capitalize.");
  }

  if (p.chargeFrequency === "at-repayment" && p.chargeDay !== null) {
    conflict(["chargeFrequency", "chargeDay"], "Interest charged at each repayment has no separate charge day.");
  }
  if (p.chargeDay !== null && !(Number.isInteger(p.chargeDay) && p.chargeDay >= 1 && p.chargeDay <= 31)) {
    conflict(["chargeDay"], "The charge day must be a day of the month from 1 to 31.");
  }

  return conflicts.length === 0 ? { ok: true } : { ok: false, code: "inconsistent-profile", conflicts };
}

/**
 * Well-defined combinations this build does not implement. They are refused
 * rather than approximated (FR-215), and may become supported later without
 * any change to the configuration.
 */
export function checkProfileSupport(profile: CalculationProfile): SupportCheck {
  const conflicts: ProfileConflict[] = [];
  const conflict = (axes: ProfileAxis[], message: string) => conflicts.push({ axes, message });
  const p = profile;

  // Generating semi-monthly dates needs the two days of the month, which config v1 cannot hold.
  // The calendar can generate them (tested), but nothing configures them yet; explicit dated
  // repayment events represent such a schedule instead.
  if (p.repaymentFrequency === "semi-monthly") {
    conflict(["repaymentFrequency"], "Generated semi-monthly repayments are not supported in configuration version 1; supply the dates as repayment events.");
  }

  const scale = p.rounding.intermediateScale;
  if (scale.mode === "fixed" && !(Number.isInteger(scale.places) && scale.places >= 0 && scale.places <= WORKING_SCALE)) {
    conflict(["rounding.intermediateScale"], `A fixed intermediate scale must be 0 to ${WORKING_SCALE} places in this build.`);
  }

  return conflicts.length === 0 ? { ok: true } : { ok: false, code: "unsupported-combination", conflicts };
}
