import type { ComponentKind, PaymentComponent } from "./model";

/**
 * Fees and other payment components (FR-057).
 *
 * Components are kept apart from the principal and interest arithmetic:
 *
 * - `cash-paid`: a flat monthly insurance premium, an account fee paid with
 *   each instalment. It adds to the cash paid and never touches the debt, the
 *   interest or the principal line.
 * - `capitalized`: a fee added to the debt on its date (economic kind `fee`,
 *   never a principal repayment, no cash moves).
 *
 * The treatment is stated on each fee (component or event), never inferred
 * and never a global switch. Only economic kind `fee` may be capitalized;
 * insurance, escrow, tax and other components are cash-paid.
 */

export type FeeTreatment = "cash-paid" | "capitalized";
export const FEE_TREATMENTS: readonly FeeTreatment[] = ["cash-paid", "capitalized"];

export const FEES_VERSION = "fees@1";

export type CashComponent = { kind: Exclude<ComponentKind, "principal" | "interest" | "draw">; amountMinor: number; label: string };

/** Fixed cash-paid components paid with every scheduled repayment, in configured order. */
export function cashComponents(components: readonly PaymentComponent[]): CashComponent[] {
  return [...components]
    .filter((c) => c.amountRule === "fixed" && c.fixedAmountMinor !== null && c.fixedAmountMinor > 0 && c.treatment !== "capitalized")
    .filter((c): c is PaymentComponent & { economicKind: CashComponent["kind"] } => c.economicKind !== "principal" && c.economicKind !== "interest" && c.economicKind !== "draw")
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ kind: c.economicKind, amountMinor: c.fixedAmountMinor as number, label: c.label }));
}

/** Fixed fees added to the debt on every scheduled repayment date, in configured order. */
export function capitalizedComponents(components: readonly PaymentComponent[]): { amountMinor: number; label: string }[] {
  return [...components]
    .filter((c) => c.economicKind === "fee" && c.treatment === "capitalized" && c.amountRule === "fixed" && c.fixedAmountMinor !== null && c.fixedAmountMinor > 0)
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ amountMinor: c.fixedAmountMinor as number, label: c.label }));
}
