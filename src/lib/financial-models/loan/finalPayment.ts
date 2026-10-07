import { addMonths, type IsoDate } from "../calendar/dates";
import type { LoanModelSnapshot } from "./model";
import type { FinalPaymentPolicy } from "./profile";

/**
 * Final payments (FR-045, FR-048, FR-068).
 *
 * The contractual term and the amortization term are separate. A contract
 * shorter than its amortization ends with principal still owed, which the
 * policy settles:
 *
 * - `true-up-to-zero`: the last contractual payment is whatever clears the
 *   balance (a few cents more or less than the level payment, or the whole
 *   remainder).
 * - `contractual-balloon`: the last level payment is made, then the remaining
 *   principal falls due as a balloon. It is never folded into a trued-up
 *   payment.
 * - `keep-level-payment-with-residual`: the last level payment is made and any
 *   remainder is reported as a residual, not paid.
 * - `continue-until-paid`: level payments continue past the contractual date
 *   until the debt is repaid, the last one smaller.
 *
 * Under every policy, a payment that would take the debt past zero is cut to
 * the amount owed (early payoff): a debt never becomes a credit (FR-048).
 */

export const FINAL_PAYMENT_VERSION = "final-payment@1";

/** The end of the contract: `maturityDate`, else opening + contractual term. */
export function contractualEnd(model: LoanModelSnapshot): IsoDate | null {
  const { terms } = model;
  if (terms.maturityDate) return terms.maturityDate;
  return terms.contractualTermMonths ? addMonths(terms.openingDate, terms.contractualTermMonths) : null;
}

/** Months on the amortization basis: amortization term, else contractual term. */
export function amortizationMonths(model: LoanModelSnapshot): number | null {
  return model.terms.amortizationTermMonths ?? model.terms.contractualTermMonths ?? null;
}

export type FinalDecisionInput = {
  policy: FinalPaymentPolicy;
  /** Principal owed before this payment, after any interest charged with it. */
  owedMinor: number;
  /** The level scheduled payment available for the debt (after cash-paid components). */
  levelMinor: number;
  /** True for the last scheduled payment within the contractual term. */
  contractualFinal: boolean;
};

export type FinalDecision = {
  /** Amount of this payment applied to the debt. */
  paymentMinor: number;
  /** Principal due as a separate balloon after this payment. */
  balloonMinor: number;
  /** Principal left unpaid and reported as a residual. */
  residualMinor: number;
  paidOff: boolean;
  /** Keep scheduling payments after this one. */
  continues: boolean;
  kind: "regular" | "early-payoff" | "true-up" | "balloon" | "residual" | "continue";
};

export function finalDecision(input: FinalDecisionInput): FinalDecision {
  const { policy, owedMinor, levelMinor, contractualFinal } = input;
  if (levelMinor >= owedMinor) {
    return { paymentMinor: owedMinor, balloonMinor: 0, residualMinor: 0, paidOff: true, continues: false, kind: contractualFinal ? "true-up" : "early-payoff" };
  }
  if (!contractualFinal) return { paymentMinor: levelMinor, balloonMinor: 0, residualMinor: 0, paidOff: false, continues: true, kind: "regular" };
  switch (policy) {
    case "true-up-to-zero":
      return { paymentMinor: owedMinor, balloonMinor: 0, residualMinor: 0, paidOff: true, continues: false, kind: "true-up" };
    case "contractual-balloon":
      return { paymentMinor: levelMinor, balloonMinor: owedMinor - levelMinor, residualMinor: 0, paidOff: true, continues: false, kind: "balloon" };
    case "keep-level-payment-with-residual":
      return { paymentMinor: levelMinor, balloonMinor: 0, residualMinor: owedMinor - levelMinor, paidOff: false, continues: false, kind: "residual" };
    case "continue-until-paid":
      return { paymentMinor: levelMinor, balloonMinor: 0, residualMinor: 0, paidOff: false, continues: true, kind: "continue" };
  }
}
