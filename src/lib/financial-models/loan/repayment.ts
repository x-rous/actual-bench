import { add, cmp, dec, DEC_ONE, DEC_ZERO, decInt, div, fromMinor, mul, powInt, round, sub, toMinor, toPlainString, WORKING_SCALE, type Dec } from "../money/kernel";
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

export const REPAYMENT_VERSION_V1 = "repayment@1";
export const REPAYMENT_VERSION = "repayment@2";

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

/** The largest principal growth per repayment Bench accepts: 5%. */
export const MAX_PROGRESSIVE_GROWTH = "0.05";
/** Decimal places a solved growth is given with, as a fraction: 8 as a percentage (the growth field's limit). */
export const PROGRESSIVE_GROWTH_PLACES = 10;

/**
 * Progressive principal (design 06 §1.1): the first instalment's principal of a basis repaying `principal` over
 * `payments` instalments whose principal grows by `growth` each time, `B × g / ((1+g)^n − 1)` (`B ÷ n` at zero growth).
 * Exact, unrounded; each instalment's principal is `progressivePrincipalAt`.
 */
export function progressiveFirstPrincipal(principal: Dec, growth: Dec, payments: number, scale: number = WORKING_SCALE): Dec {
  assertPayments(payments);
  if (cmp(growth, DEC_ZERO) < 0) throw new RangeError("Progressive principal needs a non-negative growth");
  if (cmp(growth, DEC_ZERO) === 0) return div(principal, decInt(payments), scale, "half-even");
  const factor = powInt(add(DEC_ONE, growth), payments, scale + ANNUITY_GUARD_DIGITS, "half-even");
  return div(mul(principal, growth), sub(factor, DEC_ONE), scale, "half-even");
}

/**
 * The scheduled principal of the instalment `k` places after a basis's first one: `first × (1+g)^k`, rounded once to
 * minor units by the payment rounding. Always from the exact series, never by growing a rounded amount.
 */
export function progressivePrincipalAt(first: Dec, growth: Dec, k: number, rounding: { minorDigits: number; mode: RoundingMode }): number {
  if (!Number.isSafeInteger(k) || k < 0) throw new RangeError(`An instalment offset must be a non-negative integer, got ${k}`);
  const factor = powInt(add(DEC_ONE, growth), k, WORKING_SCALE + ANNUITY_GUARD_DIGITS, "half-even");
  return toMinor(mul(first, factor), rounding.minorDigits, rounding.mode);
}

export type GrowthSolution =
  | { ok: true; growthDecimal: string }
  | { ok: false; reason: "shrinking" | "too-fast" | "invalid" };

/**
 * Solve the growth per repayment from one instalment of a lender's table: the balance before it, its principal and the
 * instalments left including it (minor units). The first principal falls as growth rises, so bisection finds the growth
 * whose exact first principal equals the given amount, stored to `PROGRESSIVE_GROWTH_PLACES` places.
 */
export function solveProgressiveGrowth(balanceMinor: number, principalMinor: number, payments: number, minorDigits: number): GrowthSolution {
  if (!Number.isSafeInteger(payments) || payments < 1 || balanceMinor <= 0 || principalMinor <= 0 || principalMinor > balanceMinor) return { ok: false, reason: "invalid" };
  const balance = fromMinor(balanceMinor, minorDigits);
  const target = fromMinor(principalMinor, minorDigits);
  const even = progressiveFirstPrincipal(balance, DEC_ZERO, payments);
  if (toMinor(even, minorDigits, "half-even") === principalMinor) return { ok: true, growthDecimal: "0" };
  if (cmp(target, even) > 0) return { ok: false, reason: "shrinking" };
  const top = dec(MAX_PROGRESSIVE_GROWTH);
  if (cmp(target, progressiveFirstPrincipal(balance, top, payments)) < 0) return { ok: false, reason: "too-fast" };
  let low = DEC_ZERO;
  let high = top;
  const two = decInt(2);
  for (let i = 0; i < 64; i++) {
    const mid = div(add(low, high), two, PROGRESSIVE_GROWTH_PLACES + 8, "half-even");
    if (cmp(progressiveFirstPrincipal(balance, mid, payments), target) > 0) low = mid;
    else high = mid;
  }
  const growth = round(div(add(low, high), two, PROGRESSIVE_GROWTH_PLACES + 8, "half-even"), PROGRESSIVE_GROWTH_PLACES, "half-even");
  return { ok: true, growthDecimal: toPlainString(growth) };
}

export type RepaymentDerivation =
  | "annuity-at-payment-frequency"
  | "dated-cashflow-annuity"
  | "monthly-equivalent-pro-rata"
  | "split-monthly"
  | "contractual-fixed"
  | "lender-provided";

export type RepaymentDerivationV1 = Exclude<RepaymentDerivation, "dated-cashflow-annuity">;

/** Frozen config-v1 vocabulary. */
export const REPAYMENT_DERIVATIONS_V1 = [
  "annuity-at-payment-frequency",
  "monthly-equivalent-pro-rata",
  "split-monthly",
  "contractual-fixed",
  "lender-provided",
] as const satisfies readonly RepaymentDerivationV1[];

/** Config-v2 vocabulary: v1 plus the dated cash-flow annuity. */
export const REPAYMENT_DERIVATIONS = [
  ...REPAYMENT_DERIVATIONS_V1,
  "dated-cashflow-annuity",
] as const satisfies readonly RepaymentDerivation[];

/**
 * Constant payment for a dated simple-interest schedule.
 *
 * Each period supplies its exact decimal simple-accrual fraction `a_i`, so
 * the balance evolves as `B_i = B_(i-1) × (1 + a_i) - payment`. Existing
 * uncharged interest is added immediately before the first payment. The
 * result is unrounded; callers apply the profile's payment rounding once.
 */
export function datedCashflowLevelPayment(
  principal: Dec,
  periodAccrualFractions: readonly Dec[],
  openingAccrued: Dec = DEC_ZERO,
  scale: number = WORKING_SCALE
): Dec {
  assertPayments(periodAccrualFractions.length);
  if (cmp(principal, DEC_ZERO) < 0 || cmp(openingAccrued, DEC_ZERO) < 0) {
    throw new RangeError("A dated cash-flow annuity needs non-negative opening amounts");
  }
  const workScale = scale + ANNUITY_GUARD_DIGITS;
  let noPaymentBalance = principal;
  let paymentCoefficient = DEC_ZERO;
  for (let i = 0; i < periodAccrualFractions.length; i++) {
    const accrual = periodAccrualFractions[i];
    if (cmp(accrual, DEC_ZERO) < 0) throw new RangeError("A dated cash-flow accrual fraction cannot be negative");
    const growth = add(DEC_ONE, accrual);
    noPaymentBalance = mul(noPaymentBalance, growth, workScale, "half-even");
    if (i === 0) noPaymentBalance = add(noPaymentBalance, openingAccrued);
    paymentCoefficient = add(mul(paymentCoefficient, growth, workScale, "half-even"), DEC_ONE);
  }
  return div(noPaymentBalance, paymentCoefficient, scale, "half-even");
}

/** Frequencies a monthly figure can be converted to. */
export type SubMonthlyFrequency = "weekly" | "fortnightly";

export type DerivationInput =
  /** A level payment computed directly at the payment frequency's periodic rate. */
  | { method: "annuity-at-payment-frequency"; principal: Dec; periodicRate: Dec; payments: number }
  /** A level payment solved over the real dated simple-interest accrual fractions. */
  | { method: "dated-cashflow-annuity"; principal: Dec; periodAccrualFractions: readonly Dec[]; openingAccrued?: Dec }
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

/** Frozen repayment@1 entry point for historical reproduction. */
export function deriveRepaymentV1(
  input: Exclude<DerivationInput, { method: "dated-cashflow-annuity" }>,
  rounding: { minorDigits: number; mode: RoundingMode }
): DerivedRepayment {
  return deriveRepayment(input, rounding);
}

function exactRepayment(input: DerivationInput): Dec {
  switch (input.method) {
    case "annuity-at-payment-frequency":
      return levelPayment(input.principal, input.periodicRate, input.payments);
    case "dated-cashflow-annuity":
      return datedCashflowLevelPayment(input.principal, input.periodAccrualFractions, input.openingAccrued);
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
