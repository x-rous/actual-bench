import { fromMinor, mul, toMinor } from "../money/kernel";
import type { LoanModelSnapshot, RevolvingModel } from "./model";

/**
 * Revolving facilities (FR-120, US9).
 *
 * A credit line tracks its limit, drawn balance and available credit, and is
 * never forced into an amortization schedule. Its scheduled payment comes from
 * the payment model alone:
 *
 * - `fixed-scheduled`: the contractual payment;
 * - `interest-only`: the interest charged in the last charge;
 * - `percent-of-balance`: balance × percentage, at least the optional floor,
 *   never more than the balance.
 *
 * Card-issuer minimum-payment formulas are not modelled: any other model is
 * unsupported (FR-215), never approximated.
 */

export const REVOLVING_VERSION = "revolving@1";

export const SUPPORTED_REVOLVING_MODELS = ["fixed-scheduled", "interest-only", "percent-of-balance"] as const;

export type RevolvingState = { limitMinor: number | null; drawnMinor: number; availableMinor: number | null };

export function revolvingState(model: LoanModelSnapshot, drawnMinor: number): RevolvingState {
  const limit = model.terms.creditLimitMinor;
  return { limitMinor: limit, drawnMinor, availableMinor: limit === null ? null : Math.max(limit - drawnMinor, 0) };
}

export type RevolvingPayment = { ok: true; minor: number } | { ok: false; reason: string };

export function isSupportedRevolvingModel(name: string): boolean {
  return (SUPPORTED_REVOLVING_MODELS as readonly string[]).includes(name);
}

/** The scheduled payment for a revolving facility, from its payment model only. */
export function revolvingPayment(
  revolving: RevolvingModel,
  input: { balanceMinor: number; lastChargeMinor: number; contractualPaymentMinor: number | null; minorDigits: number; mode: Parameters<typeof toMinor>[2] }
): RevolvingPayment {
  if (!isSupportedRevolvingModel(revolving.paymentModel)) {
    return { ok: false, reason: `Revolving payment model ${revolving.paymentModel} is not supported; issuer formulas are not modelled.` };
  }
  if (input.balanceMinor <= 0) return { ok: true, minor: 0 };
  switch (revolving.paymentModel) {
    case "fixed-scheduled":
      if (input.contractualPaymentMinor === null) return { ok: false, reason: "A fixed scheduled revolving payment needs an amount." };
      return { ok: true, minor: Math.min(input.contractualPaymentMinor, input.balanceMinor) };
    case "interest-only":
      return { ok: true, minor: Math.min(input.lastChargeMinor, input.balanceMinor) };
    case "percent-of-balance": {
      if (revolving.percentOfBalanceBps === null) return { ok: false, reason: "A percent-of-balance payment needs a percentage." };
      const share = mul(fromMinor(input.balanceMinor, input.minorDigits), { int: BigInt(revolving.percentOfBalanceBps), scale: 4 });
      let minor = toMinor(share, input.minorDigits, input.mode);
      if (revolving.minimumFloorMinor !== null) minor = Math.max(minor, revolving.minimumFloorMinor);
      return { ok: true, minor: Math.min(minor, input.balanceMinor) };
    }
  }
}

