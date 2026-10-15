import type { ActivityKind } from "./activity";
export const classificationLabels: Record<ActivityKind, string> = { purchase: "Purchase", "cash-advance": "Cash advance", "money-transfer": "Money transfer", "balance-transfer": "Balance transfer in", interest: "Interest", fee: "Fee", payment: "Payment", refund: "Refund", cashback: "Cashback / reward", "other-charge": "Other charge", "other-credit": "Other statement credit", other: "Other", ambiguous: "Unclassified", unclassified: "Unclassified" };
export const chargeChoices = ["purchase", "cash-advance", "money-transfer", "balance-transfer", "interest", "fee", "other-charge"] as const;
export const creditChoices = ["refund", "cashback", "other-credit"] as const;
export const planEligibleKinds = ["purchase", "cash-advance", "money-transfer", "balance-transfer"];
export const feeLabels = { annual: "Annual", late: "Late payment", "over-limit": "Over-limit", "cash-advance": "Cash-advance fee", "foreign-exchange": "Foreign exchange", "plan-processing": "Plan processing (upfront)", "plan-monthly": "Plan monthly fee", vat: "VAT on fee", other: "Other fee" };
