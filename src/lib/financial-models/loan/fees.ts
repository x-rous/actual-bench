import type { ComponentKind, PaymentComponent } from "./model";
import type { CalculationProfile } from "./profile";

/**
 * Fees and other payment components (FR-057).
 *
 * Components are kept apart from the principal and interest arithmetic:
 *
 * - a cash-paid component (a flat monthly insurance premium, an account fee
 *   paid with each instalment) adds to the cash paid and never touches the
 *   debt, the interest or the principal line;
 * - a capitalized fee adds to the debt, and only where the contract permits it
 *   (`feeCapitalization: permitted`).
 */

export const FEES_VERSION = "fees@1";

export type CashComponent = { kind: Exclude<ComponentKind, "principal" | "interest" | "draw">; amountMinor: number; label: string };

/** Fixed components paid with every scheduled repayment, in configured order. */
export function cashComponents(components: readonly PaymentComponent[]): CashComponent[] {
  return [...components]
    .filter((c) => c.amountRule === "fixed" && c.fixedAmountMinor !== null && c.fixedAmountMinor > 0)
    .filter((c): c is PaymentComponent & { economicKind: CashComponent["kind"] } => c.economicKind !== "principal" && c.economicKind !== "interest" && c.economicKind !== "draw")
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ kind: c.economicKind, amountMinor: c.fixedAmountMinor as number, label: c.label }));
}

export function feeCapitalizationPermitted(profile: CalculationProfile): boolean {
  return profile.feeCapitalization === "permitted";
}
