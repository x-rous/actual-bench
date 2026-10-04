import type { ActualBenchTransport } from "@/lib/actual/transport";
import { toTransactionPreflight, type PostingOutputSnapshot } from "../snapshot";

/**
 * Recovery of an interrupted apply (RD-084 P1.6 T129–T131).
 *
 * Read-only: these functions only look at Actual and report what is there.
 * A posting is never retried blindly. A create found by its marker, or a split
 * found in exactly the expected shape, is adopted without a second write; an
 * absent one goes back to Review; anything partial or changed goes to Review
 * too. A half-linked transfer is reported as needing completion, which is an
 * Actual write and therefore only ever runs from the user's explicit action.
 */

export type RecoveryResult =
  | { status: "applied"; actualIds: string[] }
  | { status: "not-found"; reason: { code: string; text: string } }
  | { status: "needs-completion"; detail: string }
  | { status: "review"; reason: { code: string; text: string } };

/** T129: an interrupted create is found by its marker, or reported missing. Never re-created here. */
export async function recoverCreate(output: Extract<PostingOutputSnapshot, { kind: "create" }>, transport: ActualBenchTransport): Promise<RecoveryResult> {
  const ids: string[] = [];
  for (const op of output.operations) {
    const rows = await transport.listTransactionsForSync({ accountId: op.accountId, startDate: op.date });
    const found = rows.filter((row) => row.importedId === op.importedId);
    if (found.length > 1) return { status: "review", reason: { code: "duplicate-marker", text: "The posting's marker appears more than once in Actual. Remove the duplicate in Actual, then re-run." } };
    if (found.length === 0) return { status: "not-found", reason: { code: "write-not-found", text: "The interrupted write is not in Actual. Review the proposal again before applying it." } };
    ids.push(found[0].id);
  }
  return { status: "applied", actualIds: ids };
}

/** T130: adopt only an exact match of the expected split; partial or changed goes to Review; never a second split. */
export async function recoverSplit(
  output: Extract<PostingOutputSnapshot, { kind: "restructure" }>,
  transport: ActualBenchTransport,
  transferPayeeByAccount: Record<string, string>
): Promise<RecoveryResult> {
  if (!transport.verifyRestructure) return { status: "review", reason: { code: "verify-unavailable", text: "This connection cannot verify the split. Check the transaction in Actual." } };
  const check = await transport.verifyRestructure({
    accountId: output.before.accountId,
    transactionId: output.before.id,
    date: output.before.date,
    expected: {
      parentAmount: output.expectedPostState.parentAmountMinor,
      children: output.expectedPostState.children.map((c) => ({ amount: c.amountMinor, categoryId: c.categoryId, payeeId: c.payeeId, notes: c.notes, transferAccountId: c.transferAccountId })),
    },
    transferPayeeByAccount,
  });
  if (check.result === "applied-exact") {
    const counterparts = check.children.filter((c) => c.transferId).map((c) => c.transferId as string);
    return { status: "applied", actualIds: [output.before.id, ...check.children.map((c) => c.id), ...counterparts] };
  }
  if (check.result === "not-applied") return { status: "not-found", reason: { code: "split-not-applied", text: "The interrupted split is not in Actual. Review the proposal again before applying it." } };
  return { status: "review", reason: { code: "split-mismatch", text: "The transaction in Actual does not match the planned split. Check it in Actual; Bench will not split it again." } };
}

/** T131: detect a half-linked pair (and any stray counterpart) without writing. */
export async function recoverLink(output: Extract<PostingOutputSnapshot, { kind: "link" }>, transport: ActualBenchTransport): Promise<RecoveryResult> {
  if (!transport.inspectTransferLink) return { status: "review", reason: { code: "verify-unavailable", text: "This connection cannot inspect transfer links. Check the rows in Actual." } };
  const state = await transport.inspectTransferLink({ source: toTransactionPreflight(output.sourceBefore), counterpart: toTransactionPreflight(output.counterpartBefore), transferPayeeId: output.transferPayeeId });
  switch (state.state) {
    case "linked": return { status: "applied", actualIds: [output.sourceBefore.id, output.counterpartBefore.id] };
    case "not-linked": return { status: "not-found", reason: { code: "link-not-applied", text: "The interrupted link is not in Actual. Review the proposal again before applying it." } };
    case "half-linked":
      return state.strayCounterpartIds.length
        ? { status: "review", reason: { code: "stray-counterpart", text: "Actual created an extra counterpart while the link was incomplete. Remove it in Actual, then re-run." } }
        : { status: "needs-completion", detail: "The transfer link was interrupted halfway. Complete it to finish the posting." };
    case "changed": return { status: "review", reason: { code: "link-changed", text: `${state.detail} Check both rows in Actual.` } };
  }
}

export async function recoverPosting(output: PostingOutputSnapshot, transport: ActualBenchTransport, transferPayeeByAccount: Record<string, string>): Promise<RecoveryResult> {
  switch (output.kind) {
    case "create": return recoverCreate(output, transport);
    case "restructure": return recoverSplit(output, transport, transferPayeeByAccount);
    case "link": return recoverLink(output, transport);
    case "claim": return { status: "applied", actualIds: output.rows.map((r) => r.id) };
  }
}
