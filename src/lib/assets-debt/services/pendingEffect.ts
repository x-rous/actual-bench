import type { PostingOutputSnapshot } from "./snapshot";

/**
 * How much a not-yet-applied change would move the loan account's balance in Actual (RD-084
 * FR-170c). Signed in Actual's own terms (minor units, Actual's sign), so the caller converts to a
 * debt magnitude with the loan's sign convention. Undos are not counted: they are not part of the
 * work that explains a gap.
 */
export function liabilityEffectMinor(output: PostingOutputSnapshot, liabilityAccountId: string): number {
  switch (output.kind) {
    case "create":
      return output.operations.reduce((sum, op) => sum + (op.accountId === liabilityAccountId ? op.amountMinor : 0) + (op.transferAccountId === liabilityAccountId ? -op.amountMinor : 0), 0);
    case "restructure": {
      const after = output.expectedPostState.children.reduce((sum, c) => sum + (c.transferAccountId === liabilityAccountId ? -c.amountMinor : 0), 0);
      const before = output.replacesCounterpart?.accountId === liabilityAccountId ? output.replacesCounterpart.amountMinor : 0;
      return after - before;
    }
    case "convert":
      return output.expectedCounterpart.accountId === liabilityAccountId ? output.expectedCounterpart.amountMinor : 0;
    case "link":
      return output.counterpartBefore.accountId === liabilityAccountId ? output.expectedPairState.counterpartAmountMinor - output.counterpartBefore.amountMinor : 0;
    case "adjust-split": {
      // The loan-side row follows the transfer part's new amount.
      const counterpart = output.counterpart;
      const child = counterpart ? output.amounts.find((a) => output.children.some((c) => c.id === a.id && c.transferId === counterpart.id)) : undefined;
      return counterpart && child && counterpart.accountId === liabilityAccountId ? -child.amountMinor - counterpart.amountMinor : 0;
    }
    default:
      return 0;
  }
}
