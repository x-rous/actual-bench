import { adjustInspection } from "../adjustSplit";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import { compareRowToSnapshot, indexReadRows, toTransactionPreflight, type PostingOutputSnapshot, type RowSnapshot } from "../snapshot";

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
    const rows = await transport.listTransactionsForSync({ resolveNames: false, accountId: op.accountId, startDate: op.date });
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
    case "restore-split": return recoverRestoreSplit(output, transport);
    case "unlink": return recoverUnlink(output, transport);
    case "convert": return recoverConvert(output, transport);
    case "revert-convert": return recoverRevert(output, transport);
    case "adjust-split": return recoverAdjustSplit(output, transport);
  }
}

async function readRows(transport: ActualBenchTransport, rows: RowSnapshot[]): Promise<Map<string, RowSnapshot>> {
  const out = new Map<string, RowSnapshot>();
  for (const accountId of [...new Set(rows.map((r) => r.accountId))]) {
    const from = rows.filter((r) => r.accountId === accountId).reduce((min, r) => (r.date < min ? r.date : min), "9999-12-31");
    for (const [id, row] of indexReadRows(await transport.listTransactionsForSync({ resolveNames: false, accountId, startDate: from }))) out.set(id, row);
  }
  return out;
}

const same = (want: RowSnapshot, now: RowSnapshot | undefined, ignore: string[] = []) =>
  now !== undefined && compareRowToSnapshot(want, now).every((d) => ignore.includes(d.field));

const HALFWAY = { code: "undo-halfway", text: "The undo stopped partway. Check the rows in Actual against the original shown here; Bench will not repeat it." };

/** T276: an undone split is the original row again; an untouched split means nothing landed. */
export async function recoverRestoreSplit(output: Extract<PostingOutputSnapshot, { kind: "restore-split" }>, transport: ActualBenchTransport): Promise<RecoveryResult> {
  const now = await readRows(transport, [output.parent]);
  const parent = now.get(output.parent.id);
  if (!parent) return { status: "review", reason: { code: "row-missing", text: "The transaction is no longer in Actual. Check it in Actual." } };
  if (parent.isParent && output.children.every((c) => now.has(c.id)) && parent.childCount === output.children.length) {
    return { status: "not-found", reason: { code: "undo-not-applied", text: "The undo did not reach Actual. Review it again before applying." } };
  }
  if (!parent.isParent && same(output.restoreTo, parent, output.recreatedCounterpart ? ["transferId"] : [])) {
    return { status: "applied", actualIds: [parent.id, ...(output.recreatedCounterpart && parent.transferId ? [parent.transferId] : [])] };
  }
  return { status: "review", reason: HALFWAY };
}

/** T276: an undone link is both original rows; an intact link means nothing landed. */
export async function recoverUnlink(output: Extract<PostingOutputSnapshot, { kind: "unlink" }>, transport: ActualBenchTransport): Promise<RecoveryResult> {
  const now = await readRows(transport, [output.source, output.counterpart]);
  const source = now.get(output.source.id);
  const counterpart = now.get(output.counterpart.id);
  if (same(output.sourceRestore, source) && same(output.counterpartRestore, counterpart)) return { status: "applied", actualIds: [output.source.id, output.counterpart.id] };
  if (same(output.source, source) && same(output.counterpart, counterpart)) return { status: "not-found", reason: { code: "undo-not-applied", text: "The undo did not reach Actual. Review it again before applying." } };
  return { status: "review", reason: HALFWAY };
}

/** T277: a converted payment is a transfer to the loan; an unchanged one means nothing landed. */
export async function recoverConvert(output: Extract<PostingOutputSnapshot, { kind: "convert" }>, transport: ActualBenchTransport): Promise<RecoveryResult> {
  const now = await readRows(transport, [output.before]);
  const payment = now.get(output.before.id);
  if (payment && payment.payeeId === output.transferPayeeId && payment.transferId) return { status: "applied", actualIds: [payment.id, payment.transferId] };
  if (same(output.before, payment)) return { status: "not-found", reason: { code: "convert-not-applied", text: "The conversion did not reach Actual. Review it again before applying." } };
  return { status: "review", reason: { code: "convert-changed", text: "The payment changed in Actual. Check it there; Bench will not convert it again." } };
}

/** T277 undo: the payment is the original again and its loan-side row is gone. */
export async function recoverRevert(output: Extract<PostingOutputSnapshot, { kind: "revert-convert" }>, transport: ActualBenchTransport): Promise<RecoveryResult> {
  const now = await readRows(transport, [output.converted, output.counterpart]);
  const payment = now.get(output.converted.id);
  if (same(output.restoreTo, payment) && !now.has(output.counterpart.id)) return { status: "applied", actualIds: [output.converted.id] };
  if (same(output.converted, payment) && now.has(output.counterpart.id)) return { status: "not-found", reason: { code: "undo-not-applied", text: "The undo did not reach Actual. Review it again before applying." } };
  return { status: "review", reason: HALFWAY };
}

/** T314: the split holds the new amounts (applied), still the old ones (nothing landed), or neither. */
export async function recoverAdjustSplit(output: Extract<PostingOutputSnapshot, { kind: "adjust-split" }>, transport: ActualBenchTransport): Promise<RecoveryResult> {
  if (!transport.inspectSplitAmounts) return { status: "review", reason: { code: "verify-unavailable", text: "This connection cannot check a split's amounts. Check the split in Actual." } };
  const state = await transport.inspectSplitAmounts(adjustInspection(output));
  if (state === "applied-exact") return { status: "applied", actualIds: [output.parent.id, ...output.children.map((c) => c.id)] };
  if (state === "not-applied") return { status: "not-found", reason: { code: "adjust-not-applied", text: "The new amounts did not reach Actual. Review the change again before applying it." } };
  return { status: "review", reason: { code: "adjust-changed", text: "The split in Actual holds neither the old nor the new amounts. Check it in Actual; Bench will not change it again." } };
}
