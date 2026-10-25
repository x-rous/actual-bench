import type { PickedTransaction } from "@/components/transactions/transactionPickerQuery";
import { parseMajorToMinor } from "@/features/assets-debt/lib/money";
import { assetMoney } from "./AssetPresentation";

/**
 * What the creation wizard will record about how the asset was obtained. Every plan reuses an existing action:
 * capitalizing an expense, recording a purchase transfer, creating or classifying an opening-balance row, or only classifying.
 */
export type PurchasePlan =
  | { kind: "skip" }
  /** The purchase was recorded as an expense: add its value to the asset; the expense stays as it is. */
  | { kind: "expense"; source: PickedTransaction }
  /** The purchase is already a transfer into the asset's account: mark it as the acquisition. */
  | { kind: "transfer"; row: PickedTransaction }
  /** Not recorded yet: create one transfer from the account paid with. */
  | { kind: "new-purchase"; fromAccountId: string; fromAccountName: string; categoryId: string; amountMinor: number; date: string; notes: string }
  /** The account already holds the starting value in a transaction. */
  | { kind: "opening-existing"; row: PickedTransaction }
  /** Enter the starting value now. */
  | { kind: "opening-new"; amountMinor: number; date: string; notes: string };

export type PlanKind = PurchasePlan["kind"];

/** Why the plan cannot go ahead yet, in plain words; null when it is complete. */
export function planProblem(plan: PurchasePlan): string | null {
  switch (plan.kind) {
    case "skip": return null;
    case "expense": return null;
    case "transfer": case "opening-existing": return null;
    case "new-purchase":
      if (!plan.fromAccountId) return "Choose the account you paid from.";
      if (!plan.categoryId) return "Choose the category for the payment.";
      if (!(plan.amountMinor > 0)) return "Enter the amount you paid.";
      return null;
    case "opening-new":
      return plan.amountMinor > 0 ? null : "Enter the starting value.";
  }
}

/** How much the plan adds to the asset's recorded value (0 when it only classifies existing transactions). */
export function planValueDelta(plan: PurchasePlan): number {
  switch (plan.kind) {
    case "expense": return -plan.source.amountMinor;
    case "new-purchase": case "opening-new": return plan.amountMinor;
    default: return 0;
  }
}
/** Whether carrying the plan out writes to Actual (a new row) or only to Bench (and possibly a Notes tag). */
export const planWritesToActual = (plan: PurchasePlan): boolean => plan.kind === "expense" || plan.kind === "new-purchase" || plan.kind === "opening-new";

const pick = (r: PickedTransaction) => `${r.payeeName ?? "No payee"} · ${r.date} · ${assetMoney(r.amountMinor)}`;
/** One plain sentence for the review step. */
export function describePlan(plan: PurchasePlan): string {
  switch (plan.kind) {
    case "skip": return "Nothing yet. You can record how you got it later from the asset.";
    case "expense": return `Add ${assetMoney(-plan.source.amountMinor)} to the asset's value using the expense ${pick(plan.source)}. The expense and its category stay exactly as they are.`;
    case "transfer": return `Mark the transfer ${pick(plan.row)} as the purchase. Its amount in Actual does not change.`;
    case "new-purchase": return `Record one transfer of ${assetMoney(plan.amountMinor)} from ${plan.fromAccountName || "the account you paid from"} to the asset's account on ${plan.date}.`;
    case "opening-existing": return `Use ${pick(plan.row)} as the asset's starting value.`;
    case "opening-new": return `Record a starting value of ${assetMoney(plan.amountMinor)} on ${plan.date} in the asset's account.`;
  }
}

/** What the wizard's "how you got it" step has collected so far. */
export type PurchaseDraft = {
  /** "existing": pick a transaction that is already in Actual; "manual": enter a value; "new": record a payment not yet in Actual. */
  path: "existing" | "manual" | "new" | "skip" | null;
  pick: PickedTransaction | null;
  fromAccountId: string; categoryId: string; amount: string; date: string; notes: string;
};
export const emptyPurchase = (): PurchaseDraft => ({ path: null, pick: null, fromAccountId: "", categoryId: "", amount: "", date: "", notes: "" });

/**
 * Why a transaction in the picker cannot be used, in plain words; null when it can. A row in the asset's own account is its
 * starting value or a purchase transfer (money in); a row anywhere else is an expense you paid (money out, with a category).
 */
export function pickReason(row: PickedTransaction, assetAccountId: string, alreadyUsed: ReadonlySet<string>): string | null {
  if (alreadyUsed.has(row.id)) return "Already used for an asset";
  if (assetAccountId && row.accountId === assetAccountId) return row.amountMinor > 0 ? null : "Only money in can be the starting value";
  if (row.transferId) return "A transfer: pick its matching transaction in the asset's account";
  if (row.amountMinor >= 0) return "Only money you paid out can be a purchase";
  if (!row.categoryId) return "Give it a category in Actual first";
  return null;
}

/** The plan the answers describe, or null while a choice is still missing. A picked transaction decides its own plan. */
export function buildPlan(d: PurchaseDraft, assetAccountId: string, accountName: (id: string) => string): PurchasePlan | null {
  const amountMinor = (() => { const parsed = parseMajorToMinor(d.amount, 2); return parsed.ok && parsed.value !== null ? parsed.value : 0; })();
  switch (d.path) {
    case "skip": return { kind: "skip" };
    case "manual": return { kind: "opening-new", amountMinor, date: d.date, notes: d.notes };
    case "new": return { kind: "new-purchase", fromAccountId: d.fromAccountId, fromAccountName: accountName(d.fromAccountId), categoryId: d.categoryId, amountMinor, date: d.date, notes: d.notes };
    case "existing":
      if (!d.pick) return null;
      if (assetAccountId && d.pick.accountId === assetAccountId) return d.pick.transferId ? { kind: "transfer", row: d.pick } : { kind: "opening-existing", row: d.pick };
      return { kind: "expense", source: d.pick };
    default: return null;
  }
}
