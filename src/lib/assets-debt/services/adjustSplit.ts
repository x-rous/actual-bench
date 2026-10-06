import type { AdjustSplitInput } from "@/lib/actual/transactionStructure";
import { toTransactionPreflight, type PostingOutputSnapshot } from "./snapshot";

/**
 * The transport inputs of an adjust-split change (T314), shared by apply and recovery so both
 * describe the same write: the split and loan-side row as they must still be, every child's old
 * and new amount, and the loan-side row that must follow the transfer part.
 */

type AdjustOutput = Extract<PostingOutputSnapshot, { kind: "adjust-split" }>;

export function adjustWrite(output: AdjustOutput): AdjustSplitInput {
  return {
    parent: toTransactionPreflight(output.parent),
    children: output.children.map(toTransactionPreflight),
    counterpart: output.counterpart ? toTransactionPreflight(output.counterpart) : null,
    amounts: output.amounts.map((a) => ({ id: a.id, amount: a.amountMinor })),
  };
}

export function adjustInspection(output: AdjustOutput) {
  const transferChild = output.counterpart ? output.children.find((c) => c.transferId === output.counterpart!.id) ?? null : null;
  return {
    accountId: output.parent.accountId,
    parentId: output.parent.id,
    date: output.parent.date,
    before: output.children.map((c) => ({ id: c.id, amount: c.amountMinor })),
    after: output.amounts.map((a) => ({ id: a.id, amount: a.amountMinor })),
    counterpart: output.counterpart && transferChild ? { accountId: output.counterpart.accountId, id: output.counterpart.id, childId: transferChild.id } : null,
  };
}
