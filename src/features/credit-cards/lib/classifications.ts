import type { ActivityRow } from "./activity";
import type { TransactionType } from "./models";
import type { TypeSource } from "./derive/types";

/** Display names for the 11 types (D7). */
export const typeLabels: Record<TransactionType, string> = {
  purchase: "Purchase",
  "cash-advance": "Cash advance",
  "balance-transfer": "Balance transfer",
  interest: "Interest",
  fee: "Fee",
  instalment: "Instalment",
  payment: "Payment",
  refund: "Refund",
  cashback: "Cashback",
  adjustment: "Adjustment",
  transfer: "Transfer",
};

/** The type name for this row's sign: a credit typed Interest is an interest refund. */
export function typeLabel(kind: TransactionType, amountMinor: number) {
  if (amountMinor > 0 && (kind === "interest" || kind === "fee")) return `${typeLabels[kind]} refund`;
  // Plan money into the card is the conversion; plan money billed back is an instalment.
  if (kind === "instalment") return amountMinor > 0 ? "Plan conversion" : "Plan instalment";
  if (amountMinor < 0 && kind === "payment") return "Payment reversal";
  return typeLabels[kind];
}

export const sourceLabels: Record<TypeSource, string> = {
  structure: "From Actual",
  user: "Set by you",
  category: "From category",
  suggested: "Suggested",
};

/** Types the user may choose for a row; refunds and cashback are credits only. */
export function typeChoices(row: Pick<ActivityRow, "amountMinor">): TransactionType[] {
  const all: TransactionType[] = [
    "purchase", "cash-advance", "balance-transfer", "interest", "fee", "payment", "refund", "cashback", "adjustment", "transfer",
  ];
  return row.amountMinor > 0 ? all : all.filter((kind) => kind !== "refund" && kind !== "cashback");
}

export { PLAN_ELIGIBLE_KINDS as planEligibleKinds } from "./derive/families";
