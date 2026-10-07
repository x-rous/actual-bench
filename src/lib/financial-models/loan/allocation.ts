import type { ComponentKind } from "./model";

/**
 * Splitting a real cash payment into economic lines (FR-066, FR-067, FR-068,
 * FR-011).
 *
 * Principal is the residual: `payment − interest − other components`, and the
 * lines always sum to the payment exactly. Every line carries an economic kind;
 * Actual categories are applied later from account budget status, never here.
 *
 * Two outcomes are never absorbed silently:
 * - a payment below interest plus required components (negative
 *   amortization): the unpaid interest is capitalized only when the profile
 *   permits it; the principal line is never negative (FR-067);
 * - a payment above what is owed (overpayment): principal is capped at the
 *   outstanding balance and the excess needs review (FR-068).
 */

export const ALLOCATION_VERSION = "allocation@1";

export type AllocationInput = {
  /** Positive magnitude of the real cash payment. */
  paymentMinor: number;
  interestMinor: number;
  /** Fees, escrow, insurance and the like, taken from the payment before principal. */
  components: { kind: Exclude<ComponentKind, "principal" | "interest" | "draw">; amountMinor: number }[];
  outstandingPrincipalMinor: number;
  negativeAmortizationAllowed: boolean;
};

export type AllocationResult =
  | {
      ok: true;
      principalMinor: number;
      /** Interest left unpaid and added to the debt (negative amortization); 0 otherwise. */
      capitalizedInterestMinor: number;
      lines: { kind: ComponentKind; amountMinor: number }[];
    }
  | { ok: false; classification: "review" | "blocked"; reason: "negative-amortization" | "overpayment" | "inconsistent" };

export function allocate(input: AllocationInput): AllocationResult {
  const { paymentMinor, interestMinor, outstandingPrincipalMinor } = input;
  const amounts = [paymentMinor, interestMinor, outstandingPrincipalMinor, ...input.components.map((c) => c.amountMinor)];
  if (amounts.some((a) => !Number.isSafeInteger(a) || a < 0)) return { ok: false, classification: "blocked", reason: "inconsistent" };

  const componentTotal = input.components.reduce((sum, c) => sum + c.amountMinor, 0);
  // Required components come first; a payment that cannot even cover them is not a loan payment.
  if (componentTotal > paymentMinor) return { ok: false, classification: "blocked", reason: "inconsistent" };

  const available = paymentMinor - componentTotal;
  const componentLines = input.components.filter((c) => c.amountMinor > 0).map((c) => ({ kind: c.kind, amountMinor: c.amountMinor }));

  if (available < interestMinor) {
    if (!input.negativeAmortizationAllowed) return { ok: false, classification: "review", reason: "negative-amortization" };
    const lines = [...(available > 0 ? [{ kind: "interest" as const, amountMinor: available }] : []), ...componentLines];
    return { ok: true, principalMinor: 0, capitalizedInterestMinor: interestMinor - available, lines };
  }

  const principal = available - interestMinor;
  if (principal > outstandingPrincipalMinor) return { ok: false, classification: "review", reason: "overpayment" };
  const lines = [
    ...(principal > 0 ? [{ kind: "principal" as const, amountMinor: principal }] : []),
    ...(interestMinor > 0 ? [{ kind: "interest" as const, amountMinor: interestMinor }] : []),
    ...componentLines,
  ];
  return { ok: true, principalMinor: principal, capitalizedInterestMinor: 0, lines };
}
