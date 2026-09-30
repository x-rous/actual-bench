import { addMonths, compareDates, type IsoDate } from "../calendar/dates";
import type { ScheduleFrequency } from "../calendar/schedule";
import { dec, fromMinor, mul, round, toMinor, DEC_ZERO, type Dec } from "../money/kernel";
import type { LoanModelSnapshot } from "./model";
import type { CalculationProfile, RecastPolicy } from "./profile";
import { periodicRate, type PaymentLimit, type RatePeriod } from "./rates";
import { deriveRepayment, levelPayment } from "./repayment";

/**
 * Scheduled payment amounts, rate-change recasts and payment caps (FR-041,
 * FR-043, FR-044, V3 §10.6–10.9).
 *
 * Frequency says when a payment falls (real dates, ../calendar/schedule);
 * this module says how much it is. The payments-per-year figures below are
 * used only to derive an amount (an annuity rate, `× 12 ÷ 26`), never to time
 * anything.
 */

export const RECAST_VERSION_V1 = "recast@1";
export const RECAST_VERSION = "recast@2";

/** Payments a year for amount derivation only; custom-dated schedules have none. */
export function paymentsPerYear(frequency: ScheduleFrequency): number | null {
  switch (frequency) {
    case "weekly":
      return 52;
    case "fortnightly":
      return 26;
    case "semi-monthly":
      return 24;
    case "monthly":
      return 12;
    case "quarterly":
      return 4;
    case "annual":
      return 1;
    case "custom-dated":
      return null;
  }
}

/** Abstract payment count over `months` at the frequency (derivation only), rounded up. */
export function paymentCount(frequency: ScheduleFrequency, months: number): number | null {
  const ppy = paymentsPerYear(frequency);
  return ppy === null ? null : Math.ceil((months * ppy) / 12);
}

export type PaymentDerivationInput = {
  model: LoanModelSnapshot;
  balanceMinor: number;
  annualRate: Dec;
  /** Payments left at the payment frequency (for `annuity-at-payment-frequency`). */
  remainingPayments: number;
  /** Months left on the amortization basis (for the monthly base of pro-rata and split). */
  remainingMonths: number;
  /** The payment in force, used by `contractual-fixed` and `lender-provided` when no contract amount is set. */
  currentPaymentMinor: number | null;
  /** Exact simple-accrual fractions for each remaining real dated period. */
  datedAccrualFractions?: readonly Dec[];
  /** Interest already accrued at the derivation boundary, before the first remaining payment. */
  openingAccrued?: Dec;
};

export type DerivedPayment = { ok: true; minor: number; exact: Dec } | { ok: false; reason: string };

/** The level scheduled payment for the profile's derivation method, rounded by `paymentRounding`. */
export function derivePayment(input: PaymentDerivationInput): DerivedPayment {
  return derivePaymentImpl(input, true);
}

/** Frozen recast@1 entry point for historical reproduction. */
export function derivePaymentV1(input: PaymentDerivationInput): DerivedPayment {
  return derivePaymentImpl(input, false);
}

function derivePaymentImpl(input: PaymentDerivationInput, allowDatedCashflow: boolean): DerivedPayment {
  const { model, annualRate } = input;
  const { profile, currency } = model;
  const rounding = { minorDigits: currency.minorDigits, mode: profile.rounding.paymentRounding };
  const balance = fromMinor(input.balanceMinor, currency.minorDigits);
  switch (profile.repaymentDerivation) {
    case "annuity-at-payment-frequency": {
      const ppy = paymentsPerYear(profile.repaymentFrequency);
      if (ppy === null) return { ok: false, reason: "An annuity needs a regular payment frequency." };
      if (input.remainingPayments < 1) return { ok: false, reason: "No payments remain on the amortization basis." };
      const r = periodicRate(profile.rateQuote, annualRate, ppy);
      const d = deriveRepayment({ method: "annuity-at-payment-frequency", principal: balance, periodicRate: r, payments: input.remainingPayments }, rounding);
      return { ok: true, minor: d.minor, exact: d.exact };
    }
    case "dated-cashflow-annuity": {
      if (!allowDatedCashflow) return { ok: false, reason: "repayment@1 does not support dated-cashflow-annuity." };
      if (!input.datedAccrualFractions?.length) return { ok: false, reason: "A dated cash-flow annuity needs the remaining dated accrual schedule." };
      const d = deriveRepayment(
        {
          method: "dated-cashflow-annuity",
          principal: balance,
          periodAccrualFractions: input.datedAccrualFractions,
          openingAccrued: input.openingAccrued ?? DEC_ZERO,
        },
        rounding
      );
      return { ok: true, minor: d.minor, exact: d.exact };
    }
    case "monthly-equivalent-pro-rata":
    case "split-monthly": {
      if (profile.repaymentFrequency !== "weekly" && profile.repaymentFrequency !== "fortnightly") {
        return { ok: false, reason: `${profile.repaymentDerivation} needs weekly or fortnightly repayments.` };
      }
      if (input.remainingMonths < 1) return { ok: false, reason: "No months remain on the amortization basis." };
      // The monthly base is itself a posted amount: round it first, then convert (as lenders publish it).
      const monthlyExact = levelPayment(balance, periodicRate(profile.rateQuote, annualRate, 12), input.remainingMonths);
      const monthly = round(monthlyExact, currency.minorDigits, profile.rounding.paymentRounding);
      const d = deriveRepayment({ method: profile.repaymentDerivation, monthlyPayment: monthly, frequency: profile.repaymentFrequency }, rounding);
      return { ok: true, minor: d.minor, exact: d.exact };
    }
    case "contractual-fixed":
    case "lender-provided": {
      const minor = input.currentPaymentMinor ?? model.terms.contractualPaymentMinor;
      if (minor === null || minor === undefined) return { ok: false, reason: `${profile.repaymentDerivation} needs a payment amount.` };
      return { ok: true, minor, exact: fromMinor(minor, currency.minorDigits) };
    }
  }
}

export type CappedPayment = {
  minor: number;
  /** The recalculated payment before any cap. */
  uncappedMinor: number;
  capped: boolean;
  /** The cap's maximum, when a cap applied. */
  capMaxMinor: number | null;
};

/**
 * Apply a payment cap to a recalculated payment. `absolute` caps at a fixed
 * amount; `previous-payment-factor` caps at `previous × factor`, rounded by
 * the payment rounding mode (1.075 on $570.42 → $613.20). A factor cap with no
 * previous payment cannot be evaluated and leaves the payment unchanged, with
 * `capMaxMinor` null.
 */
export function applyPaymentCap(
  candidateMinor: number,
  previousMinor: number | null,
  cap: PaymentLimit | null | undefined,
  profile: CalculationProfile,
  minorDigits: number
): CappedPayment {
  const uncapped = { minor: candidateMinor, uncappedMinor: candidateMinor, capped: false, capMaxMinor: null };
  if (!cap) return uncapped;
  let maxMinor: number;
  if (cap.kind === "absolute") {
    maxMinor = cap.amountMinor;
  } else {
    if (previousMinor === null) return uncapped;
    const product = mul(fromMinor(previousMinor, minorDigits), dec(cap.factor));
    maxMinor = toMinor(product, minorDigits, profile.rounding.paymentRounding);
  }
  const minor = Math.min(candidateMinor, maxMinor);
  return { minor, uncappedMinor: candidateMinor, capped: minor < candidateMinor, capMaxMinor: maxMinor };
}

/** The recast policy that governs a rate period's payment change. */
export function recastPolicyFor(period: RatePeriod, profile: CalculationProfile): RecastPolicy {
  const override = period.paymentRecalcPolicy as RecastPolicy | null | undefined;
  return override ?? profile.recast;
}

/** When a rate period's recalculated payment takes effect: its payment date, else its accrual date. */
export function paymentEffectiveDate(period: RatePeriod): IsoDate {
  return period.paymentEffectiveFrom ?? period.accrualEffectiveFrom;
}

/** Anniversaries of `firstPaymentDate` in (after, onOrBefore], for `annual` recasts. */
export function annualRecastDates(firstPaymentDate: IsoDate, after: IsoDate, onOrBefore: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let k = 1; ; k++) {
    const date = addMonths(firstPaymentDate, 12 * k);
    if (compareDates(date, onOrBefore) > 0) return out;
    if (compareDates(date, after) > 0) out.push(date);
  }
}
