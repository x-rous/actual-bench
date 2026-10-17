import type { Statement } from "./models";

/** Original cycle payment target in integer minor units; defaults are never bank savings claims. */
export function paymentTarget(statement: Statement) {
  return statement.totalPaymentDueMinor ?? Math.max(0, statement.officialBalanceMinor);
}

/** Payment target remaining, in integer minor units. Credits affect debt, never this target. */
export function paymentTargetRemaining(statement: Statement, paidMinor: number) {
  return Math.max(0, paymentTarget(statement) - paidMinor);
}
