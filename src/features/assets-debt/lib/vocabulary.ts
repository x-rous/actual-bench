import type { SelectOption } from "@/components/ui/select";
import { DAY_COUNT_CATALOG } from "@/lib/financial-models/loan/daycount/registry";
import type { CalculationProfile } from "@/lib/financial-models/loan/profile";

/**
 * Labels and support status for the loan editor (RD-084 P1.3).
 *
 * Offers exactly what configuration version 1 supports. A listed identifier
 * that cannot be used yet is shown disabled with its reason; researched
 * conventions that are not offered (MSRB G-33, generic 30U/360) are never
 * shown. Interest-only is a phase, not an amortization method.
 */

type Option<T extends string> = { value: T; label: string; description?: string; unavailable?: string };

const toSelect = <T extends string>(options: Option<T>[]): SelectOption[] =>
  options.map((o) => ({ value: o.value, label: o.unavailable ? `${o.label} (not available: ${o.unavailable})` : o.label, disabled: !!o.unavailable }));

export const DEBT_TYPE_OPTIONS: SelectOption[] = toSelect([
  { value: "mortgage", label: "Mortgage" },
  { value: "personal-loan", label: "Personal loan" },
  { value: "car-loan", label: "Car loan" },
  { value: "student-loan", label: "Student loan" },
  { value: "heloc", label: "HELOC / revolving credit" },
  { value: "loan-receivable", label: "Loan I made (receivable)" },
  { value: "other", label: "Other" },
]);

export const BEHAVIOR_OPTIONS: SelectOption[] = toSelect([
  { value: "term-loan", label: "Term loan: repaid over a fixed term" },
  { value: "revolving-credit", label: "Revolving credit: draw and repay against a limit" },
  { value: "receivable-loan", label: "Receivable: money owed to me" },
]);

export const LENDER_PATTERN_OPTIONS: SelectOption[] = toSelect([
  { value: "separate-interest", label: "The lender charges interest as its own transaction" },
  { value: "embedded-interest", label: "Interest is inside each repayment" },
]);

export const SIGN_CONVENTION_OPTIONS: SelectOption[] = toSelect([
  { value: "negative-is-debt", label: "Debt shows as a negative balance (Actual's usual way)" },
  { value: "positive-is-debt", label: "Debt shows as a positive balance" },
]);

export const STRATEGY_OPTIONS: SelectOption[] = toSelect([
  { value: "bench-periodic", label: "Actual Bench, period by period" },
  { value: "bench-daily", label: "Actual Bench, day by day" },
  { value: "actual-formula-rule", label: "An Actual formula rule" },
]);

/** Every day count in the v1 vocabulary; the Figura monthly allocation stays listed but unselectable. */
export const DAY_COUNT_OPTIONS: SelectOption[] = toSelect([
  { value: "actual-365-fixed", label: "Actual/365 Fixed" },
  { value: "actual-actual-calendar", label: "Actual/Actual (calendar year)" },
  { value: "actual-360", label: "Actual/360" },
  {
    value: "monthly-30-360-actual-day-allocation",
    label: "Monthly 30/360 with actual-day allocation",
    unavailable: DAY_COUNT_CATALOG["monthly-30-360-actual-day-allocation"].selectable ? undefined : "no verified published source yet",
  },
]);

export const RATE_QUOTE_OPTIONS: SelectOption[] = toSelect([
  { value: "nominal-simple-periodic", label: "Nominal annual rate, divided by payments per year" },
  { value: "nominal-compounded-monthly", label: "Nominal annual rate, compounded monthly" },
  { value: "nominal-compounded-semiannual", label: "Nominal annual rate, compounded semi-annually" },
  { value: "annual-effective", label: "Effective annual rate" },
]);

export const AMORTIZATION_OPTIONS: SelectOption[] = toSelect([
  { value: "level-payment", label: "Level payment" },
  { value: "constant-principal", label: "Constant principal plus interest" },
  { value: "custom-payment", label: "Custom payment" },
  { value: "revolving", label: "Revolving (no amortization)" },
]);

export const ACCRUAL_OPTIONS: SelectOption[] = toSelect([
  { value: "per-period", label: "Per payment period" },
  { value: "daily-simple", label: "Daily, simple (charged later)" },
  { value: "daily-compounded", label: "Daily, compounded" },
]);

export const CHARGE_FREQUENCY_OPTIONS: SelectOption[] = toSelect([
  { value: "at-repayment", label: "With each repayment" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annually" },
]);

export const CAPITALIZATION_OPTIONS: SelectOption[] = toSelect([
  { value: "at-charge", label: "When interest is charged" },
  { value: "daily", label: "Daily" },
]);

export const REPAYMENT_FREQUENCY_OPTIONS: SelectOption[] = toSelect([
  { value: "monthly", label: "Monthly" },
  { value: "fortnightly", label: "Fortnightly (every 14 days)" },
  { value: "weekly", label: "Weekly (every 7 days)" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annually" },
  { value: "semi-monthly", label: "Twice a month", unavailable: "not supported in configuration version 1" },
  { value: "custom-dated", label: "Custom dates", unavailable: "dates are entered as repayment events, not generated" },
]);

export const REPAYMENT_DERIVATION_OPTIONS: SelectOption[] = toSelect([
  { value: "annuity-at-payment-frequency", label: "Level payment at the repayment frequency" },
  { value: "monthly-equivalent-pro-rata", label: "Monthly payment × 12 ÷ payments per year" },
  { value: "split-monthly", label: "Monthly payment split evenly" },
  { value: "contractual-fixed", label: "The contract's fixed payment" },
  { value: "lender-provided", label: "Whatever the lender says" },
]);

export const RECAST_OPTIONS: SelectOption[] = toSelect([
  { value: "on-rate-change", label: "When the rate changes" },
  { value: "never", label: "Never" },
  { value: "annual", label: "Once a year" },
  { value: "on-contract-date", label: "On the contract's recast dates" },
  { value: "lender-provided", label: "When the lender says" },
]);

/** Per-rate overrides: only these make sense on a single rate change (G1). */
export const PER_RATE_RECAST_OPTIONS: SelectOption[] = [
  { value: "", label: "Use the contract's recast rule" },
  ...toSelect([
    { value: "on-rate-change", label: "Recalculate the payment" },
    { value: "never", label: "Keep the payment" },
    { value: "lender-provided", label: "The lender sets the payment" },
  ]),
];

export const FINAL_PAYMENT_OPTIONS: SelectOption[] = toSelect([
  { value: "true-up-to-zero", label: "Adjust the last payment to clear the debt" },
  { value: "contractual-balloon", label: "A balloon payment at maturity" },
  { value: "keep-level-payment-with-residual", label: "Keep the level payment; leave a residual" },
  { value: "continue-until-paid", label: "Keep paying until it is paid off" },
]);

export const ROUNDING_OPTIONS: SelectOption[] = toSelect([
  { value: "half-up", label: "Half up" },
  { value: "half-even", label: "Half even (banker's)" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down (truncate)" },
]);

export const BALANCE_PRECISION_OPTIONS: SelectOption[] = toSelect([
  { value: "round-each-posting", label: "Round each posting" },
  { value: "round-each-event", label: "Round each event" },
  { value: "carry-full-precision", label: "Carry full precision" },
]);

export const EVENT_TIMING_OPTIONS: SelectOption[] = toSelect([
  { value: "start-of-day", label: "Before the day's interest" },
  { value: "end-of-day", label: "After the day's interest" },
]);

export const ECONOMIC_KIND_OPTIONS: SelectOption[] = toSelect([
  { value: "principal", label: "Principal" },
  { value: "interest", label: "Interest" },
  { value: "fee", label: "Fee" },
  { value: "escrow", label: "Escrow" },
  { value: "insurance", label: "Insurance" },
  { value: "tax", label: "Tax" },
  { value: "draw", label: "Draw" },
  { value: "other", label: "Other" },
]);

export const DESTINATION_OPTIONS: SelectOption[] = toSelect([
  { value: "transfer", label: "Transfer to the loan account" },
  { value: "category", label: "Expense category" },
  { value: "income-category", label: "Income category" },
  { value: "tracking-only", label: "Track only" },
]);

export const AMOUNT_RULE_OPTIONS: SelectOption[] = toSelect([
  { value: "calculated", label: "Calculated" },
  { value: "fixed", label: "Fixed amount" },
  { value: "lender-provided", label: "From the lender" },
]);

export const FEE_TREATMENT_OPTIONS: SelectOption[] = toSelect([
  { value: "cash-paid", label: "Paid in cash with the repayment" },
  { value: "capitalized", label: "Added to the debt" },
]);

export const OFFSET_BASIS_OPTIONS: SelectOption[] = toSelect([
  { value: "total", label: "Total balance" },
  { value: "cleared", label: "Cleared balance" },
]);

export const REVOLVING_MODEL_OPTIONS: SelectOption[] = toSelect([
  { value: "fixed-scheduled", label: "A fixed scheduled payment" },
  { value: "interest-only", label: "Interest only" },
  { value: "percent-of-balance", label: "A percentage of the balance" },
]);

export function labelOf(options: SelectOption[], value: string | null | undefined): string {
  const found = options.find((o) => o.value === value);
  return typeof found?.label === "string" ? found.label : (value ?? "");
}

/**
 * Starting points for the calculation profile (FR-050). A preset only fills
 * explicit, editable fields; it describes a calculation shape, never a
 * lender, and choosing one claims nothing about any particular loan.
 */
export type ProfilePreset = { id: string; label: string; description: string; profile: Partial<CalculationProfile> };

export const PROFILE_PRESETS: ProfilePreset[] = [
  {
    id: "generic-monthly-amortizing",
    label: "Monthly level payment",
    description: "Interest for each month is the annual rate ÷ 12 on the balance; the same payment every month.",
    profile: { amortization: "level-payment", rateQuote: "nominal-simple-periodic", accrual: "per-period", chargeFrequency: "at-repayment", chargeDay: null, capitalization: "at-charge", repaymentFrequency: "monthly", repaymentDerivation: "annuity-at-payment-frequency", recast: "on-rate-change", finalPayment: "true-up-to-zero" },
  },
  {
    id: "generic-daily-interest-monthly-charge",
    label: "Daily interest, charged monthly",
    description: "Interest accrues daily (Actual/365) and is charged once a month; repayments on their own schedule.",
    profile: { amortization: "level-payment", rateQuote: "nominal-simple-periodic", dayCount: "actual-365-fixed", accrual: "daily-simple", chargeFrequency: "monthly", chargeDay: 1, capitalization: "at-charge", repaymentFrequency: "monthly", repaymentDerivation: "annuity-at-payment-frequency", recast: "on-rate-change", finalPayment: "true-up-to-zero" },
  },
  {
    id: "generic-semiannual-compounding",
    label: "Rate compounded semi-annually, paid monthly",
    description: "The quoted rate compounds twice a year; payments are monthly.",
    profile: { amortization: "level-payment", rateQuote: "nominal-compounded-semiannual", accrual: "per-period", chargeFrequency: "at-repayment", chargeDay: null, capitalization: "at-charge", repaymentFrequency: "monthly", repaymentDerivation: "annuity-at-payment-frequency", recast: "on-rate-change", finalPayment: "true-up-to-zero" },
  },
  {
    id: "generic-constant-principal",
    label: "Constant principal plus interest",
    description: "The same principal each period plus that period's interest, so payments fall over time.",
    profile: { amortization: "constant-principal", rateQuote: "nominal-simple-periodic", accrual: "per-period", chargeFrequency: "at-repayment", chargeDay: null, capitalization: "at-charge", repaymentFrequency: "monthly", repaymentDerivation: "contractual-fixed", recast: "never", finalPayment: "true-up-to-zero" },
  },
];
