import type { Statement } from "./models";

/** Original cycle payment target in integer minor units; defaults are never bank savings claims. */
export function paymentTarget(statement: Statement) {
  return statement.totalPaymentDueMinor ?? Math.max(0, statement.officialBalanceMinor);
}

/** Payment target remaining, in integer minor units. Credits affect debt, never this target. */
export function paymentTargetRemaining(statement: Statement, paidMinor: number) {
  return Math.max(0, paymentTarget(statement) - paidMinor);
}

/** Confirmed payment obligation, in integer minor units. Pending transfers and credits never cover it. */
export function confirmedPaymentProgress(statement: Statement, payment: import("./repayments").Settlement | undefined) {
  const known = payment?.recordedDebtRemainingMinor != null && payment.recordedMinimumRemainingMinor != null;
  return {
    known,
    toPayMinor: known ? paymentTargetRemaining(statement, payment.confirmedPaidMinor) : null,
    minimumToPayMinor: known ? Math.max(0, statement.minimumDueMinor - payment.confirmedPaidMinor) : null,
  };
}
