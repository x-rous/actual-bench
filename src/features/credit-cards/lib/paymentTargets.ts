import type { Statement } from "./models";

/** Original cycle payment target in integer minor units; defaults are never bank savings claims. */
export function paymentTarget(statement: Statement) {
  return statement.totalPaymentDueMinor ?? Math.max(0, statement.officialBalanceMinor);
}
