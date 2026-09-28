import { add, cmp, DEC_ONE, DEC_ZERO, decInt, div, mul, powInt, sub, toMinor, WORKING_SCALE, type Dec } from "../money/kernel";
import type { RoundingMode } from "../money/rounding";

/**
 * Repayment amounts (FR-036, FR-041, V3 §10.1 and §10.6).
 *
 * Two separate questions, never merged: how often the borrower pays
 * (frequency, in ../calendar/schedule) and how the amount of each payment was
 * worked out (derivation, here). A fortnightly payment of "monthly × 12 ÷ 26"
 * and one of "monthly ÷ 2" are both fortnightly, and a year of the second
 * pays about one extra monthly payment more than a year of the first.
 */

export const REPAYMENT_VERSION = "repayment@1";

/** Digits carried in the annuity growth factor before the single division. */
const ANNUITY_GUARD_DIGITS = 10;

/**
 * Level payment `P × r × (1+r)^n / ((1+r)^n − 1)`, or `P ÷ n` at a zero rate,
 * unrounded (to `scale` places, half-even). Round with the profile's payment
 * rounding when posting.
 */
export function levelPayment(principal: Dec, periodicRate: Dec, payments: number, scale: number = WORKING_SCALE): Dec {
  assertPayments(payments);
  if (cmp(periodicRate, DEC_ZERO) === 0) return div(principal, decInt(payments), scale, "half-even");
  if (cmp(periodicRate, DEC_ZERO) < 0) throw new RangeError("A level payment needs a non-negative periodic rate");
  const growth = powInt(add(DEC_ONE, periodicRate), payments, scale + ANNUITY_GUARD_DIGITS, "half-even");
  return div(mul(mul(principal, periodicRate), growth), sub(growth, DEC_ONE), scale, "half-even");
}

/** Constant principal: `original principal ÷ principal periods`; interest and fees are added per period. */
export function constantPrincipalInstallment(originalPrincipal: Dec, principalPeriods: number, scale: number = WORKING_SCALE): Dec {
  assertPayments(principalPeriods);
  return div(originalPrincipal, decInt(principalPeriods), scale, "half-even");
}

export type RepaymentDerivation =
  | "annuity-at-payment-frequency"
  | "monthly-equivalent-pro-rata"
  | "split-monthly"
  | "contractual-fixed"
  | "lender-provided";

export const REPAYMENT_DERIVATIONS: readonly RepaymentDerivation[] = [
  "annuity-at-payment-frequency",
  "monthly-equivalent-pro-rata",
  "split-monthly",
  "contractual-fixed",
  "lender-provided",
];

/** Frequencies a monthly figure can be converted to. */
export type SubMonthlyFrequency = "weekly" | "fortnightly";

export type DerivationInput =
  /** A level payment computed directly at the payment frequency's periodic rate. */
  | { method: "annuity-at-payment-frequency"; principal: Dec; periodicRate: Dec; payments: number }
  /** Monthly × 12 ÷ 26 (fortnightly) or × 12 ÷ 52 (weekly): the same yearly total, paid more often. */
  | { method: "monthly-equivalent-pro-rata"; monthlyPayment: Dec; frequency: SubMonthlyFrequency }
  /** Monthly ÷ 2 (fortnightly) or ÷ 4 (weekly): a larger yearly total. */
  | { method: "split-monthly"; monthlyPayment: Dec; frequency: SubMonthlyFrequency }
  /** A payment stated in the contract. */
  | { method: "contractual-fixed"; amount: Dec }
  /** A payment the lender reports, taken as given. */
  | { method: "lender-provided"; amount: Dec };

export type DerivedRepayment = { method: RepaymentDerivation; exact: Dec; minor: number };

/** The repayment for one period, exact and rounded to minor units by the profile's payment rounding. */
export function deriveRepayment(input: DerivationInput, rounding: { minorDigits: number; mode: RoundingMode }): DerivedRepayment {
  const exact = exactRepayment(input);
  if (cmp(exact, DEC_ZERO) < 0) throw new RangeError("A repayment cannot be negative");
  return { method: input.method, exact, minor: toMinor(exact, rounding.minorDigits, rounding.mode) };
}

function exactRepayment(input: DerivationInput): Dec {
  switch (input.method) {
    case "annuity-at-payment-frequency":
      return levelPayment(input.principal, input.periodicRate, input.payments);
    case "monthly-equivalent-pro-rata":
      return div(mul(input.monthlyPayment, decInt(12)), decInt(input.frequency === "fortnightly" ? 26 : 52), WORKING_SCALE, "half-even");
    case "split-monthly":
      return div(input.monthlyPayment, decInt(input.frequency === "fortnightly" ? 2 : 4), WORKING_SCALE, "half-even");
    case "contractual-fixed":
    case "lender-provided":
      return input.amount;
    default:
      throw new RangeError(`Unknown repayment derivation: ${String((input as { method: unknown }).method)}`);
  }
}

function assertPayments(n: number): void {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`Payment count must be a positive integer, got ${n}`);
}
