import type { TransactionType } from "../models";

/**
 * The single type → family map. Every total, breakdown, filter and guard groups transaction
 * types through this table; never list types inline elsewhere.
 */
export type Family =
  | "charge"
  | "interest"
  | "fee"
  | "plan"
  | "payment"
  | "refund"
  | "cashback"
  | "adjustment"
  | "transfer";

export const KIND_FAMILY: Record<TransactionType, Family> = {
  purchase: "charge",
  "cash-advance": "charge",
  "balance-transfer": "charge",
  interest: "interest",
  fee: "fee",
  instalment: "plan",
  payment: "payment",
  refund: "refund",
  cashback: "cashback",
  adjustment: "adjustment",
  transfer: "transfer",
};

export const familyOf = (kind: TransactionType) => KIND_FAMILY[kind];

/** Interest and fees (with their refunds) are financing costs; everything else is not. */
export function costFamilyOf(kind: TransactionType): "interest" | "fee" | null {
  const family = KIND_FAMILY[kind];
  return family === "interest" || family === "fee" ? family : null;
}

/** Charges that borrow money (no purchase grace period). */
export const BORROWING_KINDS: readonly TransactionType[] = ["cash-advance", "balance-transfer"];

/** Charges that can become the original of an instalment plan. */
export const PLAN_ELIGIBLE_KINDS: readonly TransactionType[] = ["purchase", ...BORROWING_KINDS];

/**
 * A credit that reduces a bill's balance without being a payment (D14): refunds, cashback,
 * waivers and reversals. Payments, plan movements and transfers are never credits.
 */
export function isCreditKind(kind: TransactionType, amountMinor: number) {
  const family = KIND_FAMILY[kind];
  return amountMinor > 0 && family !== "payment" && family !== "plan" && family !== "transfer";
}
