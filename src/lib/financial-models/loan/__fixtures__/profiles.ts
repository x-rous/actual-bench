import type { CalculationProfile } from "../profile";

/* Test support: sample calculation profiles shared by the loan tests. */

/** An Australian-style variable home loan: daily simple accrual, monthly charge, fortnightly repayments. */
export const AU_PROFILE: CalculationProfile = {
  amortization: "level-payment",
  rateQuote: "nominal-simple-periodic",
  dayCount: "actual-365-fixed",
  accrual: "daily-simple",
  chargeFrequency: "monthly",
  chargeDay: 1,
  capitalization: "at-charge",
  repaymentFrequency: "fortnightly",
  repaymentDerivation: "monthly-equivalent-pro-rata",
  recast: "on-rate-change",
  rateEffectiveTiming: "on-accrual-effective-date",
  repaymentEffectiveTiming: "on-payment-date",
  rounding: {
    paymentRounding: "half-up",
    interestPostingRounding: "half-up",
    intermediateScale: { mode: "fixed", places: 5 },
    intermediateRounding: "half-up",
    balancePrecision: "round-each-posting",
  },
  eventOrder: { timing: "start-of-day" },
  finalPayment: "true-up-to-zero",
  shortMonth: "clamp-to-last-calendar-day",
  negativeAmortizationAllowed: false,
  presetId: null,
};
