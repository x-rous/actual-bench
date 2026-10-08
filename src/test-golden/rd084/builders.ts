import type { LedgerEvent, LoanModelSnapshot, OffsetLink, PaymentComponent } from "@/lib/financial-models/loan/model";
import type { CalculationProfile } from "@/lib/financial-models/loan/profile";
import type { RatePeriod } from "@/lib/financial-models/loan/rates";

/**
 * Builds engine inputs for the golden suite. Test support: the neutral place
 * where the engine (src/lib/financial-models) and the independent oracle
 * (src/test-oracles/rd084) meet. Neither of those may import the other
 * (eslint.config.mjs); only these comparison tests see both.
 */

export const BASE_PROFILE: CalculationProfile = {
  amortization: "level-payment",
  rateQuote: "nominal-simple-periodic",
  dayCount: "actual-365-fixed",
  accrual: "per-period",
  chargeFrequency: "at-repayment",
  chargeDay: null,
  capitalization: "at-charge",
  repaymentFrequency: "monthly",
  repaymentDerivation: "annuity-at-payment-frequency",
  recast: "never",
  rateEffectiveTiming: "on-accrual-effective-date",
  repaymentEffectiveTiming: "transaction-date",
  rounding: {
    paymentRounding: "half-up",
    interestPostingRounding: "half-up",
    intermediateScale: { mode: "full" },
    intermediateRounding: "half-even",
    balancePrecision: "round-each-posting",
  },
  eventOrder: { timing: "start-of-day" },
  finalPayment: "true-up-to-zero",
  shortMonth: "clamp-to-last-calendar-day",
  negativeAmortizationAllowed: false,
  interestOnlyRepayment: "charged-interest-outstanding",
  presetId: null,
};

export type ModelOverrides = {
  principalMinor: number;
  openingDate: string;
  firstPaymentDate: string;
  contractualTermMonths: number;
  amortizationTermMonths?: number;
  contractualPaymentMinor?: number | null;
  firstInterestChargeDate?: string | null;
  creditLimitMinor?: number | null;
  rates: RatePeriod[];
  profile?: Partial<CalculationProfile>;
  phases?: LoanModelSnapshot["phases"];
  offsets?: OffsetLink[];
  components?: PaymentComponent[];
  assumptions?: LoanModelSnapshot["assumptions"];
  paymentRecasts?: LoanModelSnapshot["paymentRecasts"];
  digits?: number;
  behaviorClass?: LoanModelSnapshot["behaviorClass"];
};

export function model(o: ModelOverrides): LoanModelSnapshot {
  return {
    debtId: "golden",
    revision: 1,
    currency: { code: o.digits === 0 ? "JPY" : "USD", minorDigits: o.digits ?? 2 },
    behaviorClass: o.behaviorClass ?? "term-loan",
    lenderPattern: null,
    terms: {
      openingDate: o.openingDate,
      openingPrincipalMinor: o.principalMinor,
      maturityDate: null,
      contractualTermMonths: o.contractualTermMonths,
      amortizationTermMonths: o.amortizationTermMonths ?? o.contractualTermMonths,
      contractualPaymentMinor: o.contractualPaymentMinor ?? null,
      creditLimitMinor: o.creditLimitMinor ?? null,
      firstPaymentDate: o.firstPaymentDate,
      firstInterestChargeDate: o.firstInterestChargeDate ?? null,
    },
    profile: { ...BASE_PROFILE, ...o.profile, rounding: { ...BASE_PROFILE.rounding, ...o.profile?.rounding } },
    rates: o.rates,
    phases: o.phases ?? [],
    offsets: o.offsets ?? [],
    components: o.components ?? [],
    paymentRecasts: o.paymentRecasts ?? [],
    assumptions: o.assumptions ?? [],
    revolving: null,
  };
}

let refCounter = 0;
export function ledger(kind: "extra-repayment" | "draw" | "repayment", date: string, amountMinor: number): LedgerEvent {
  return { kind, date, amountMinor, ref: { source: "actual", id: `g${++refCounter}` } };
}
