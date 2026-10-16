import type { ActivityKind } from "./activity";
import type { ActivityRow } from "./activity";
import type { ActivityClassification } from "./models";
export const classificationLabels: Record<ActivityKind, string> = { purchase: "Purchase", "cash-advance": "Cash advance", "money-transfer": "Money transfer", "balance-transfer": "Balance transfer", interest: "Interest / profit", fee: "Fee", "interest-refund": "Interest refund", "fee-refund": "Fee refund", payment: "Payment", transfer: "Transfer", "plan-instalment": "Plan instalment", "plan-conversion": "Plan conversion", "plan-adjustment": "Plan adjustment", "dispute-credit": "Dispute credit", "dispute-adjustment": "Dispute adjustment", adjustment: "Adjustment", refund: "Refund / credit", cashback: "Cashback / reward", "other-charge": "Other charge", "other-credit": "Other statement credit", other: "Other", ambiguous: "Purchase / credit", unclassified: "Purchase / credit" };
export const chargeChoices = ["purchase", "cash-advance", "money-transfer", "balance-transfer", "interest", "fee", "transfer", "plan-instalment", "plan-adjustment", "dispute-adjustment", "adjustment", "other-charge"] as const;
export const creditChoices = ["refund", "cashback", "interest-refund", "fee-refund", "plan-conversion", "plan-adjustment", "dispute-credit", "adjustment", "other-credit"] as const;
export function classificationChoices(row: ActivityRow): ActivityClassification["kind"][] {
  if (row.amountMinor === 0) return ["adjustment"];
  if (row.amountMinor > 0) return row.transferId ? ["payment", ...creditChoices] : [...creditChoices];
  return row.transferId ? chargeChoices.filter((kind) => !["purchase", "interest", "fee"].includes(kind)) : [...chargeChoices];
}
export const planEligibleKinds = ["purchase", "cash-advance", "money-transfer", "balance-transfer"];
export const feeLabels = { annual: "Annual", late: "Late payment", "over-limit": "Over-limit", "cash-advance": "Cash-advance fee", "foreign-exchange": "Foreign exchange", "plan-processing": "Plan processing (upfront)", "plan-monthly": "Plan monthly fee", vat: "VAT on fee", other: "Other fee" };
