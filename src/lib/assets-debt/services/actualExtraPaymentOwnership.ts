import type { DebtAssumptionRecord, DebtTransactionLinkRecord } from "@/lib/app-db/types";

export const ACTUAL_EXTRA_PAYMENT_NOTE = "Extra payment recorded from Actual";

/** Use the same generated-event association as extra-payment refresh/removal; notes alone are insufficient. */
export function actualExtraPaymentAssumptionIds(assumptions: readonly DebtAssumptionRecord[], links: readonly DebtTransactionLinkRecord[]): string[] {
  const dates = new Set(links.filter((link) => link.role === "extra-repayment").map((link) => link.periodKey));
  return assumptions.filter((a) => a.assumptionKind === "extra-repayment" && a.recurrence === null
    && a.note === ACTUAL_EXTRA_PAYMENT_NOTE && dates.has(a.effectiveFrom)).map((a) => a.id);
}
