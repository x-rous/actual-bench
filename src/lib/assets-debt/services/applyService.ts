import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import type { LinkTransferInput } from "@/lib/actual/transactionStructure";
import { adjustInspection, adjustWrite } from "./adjustSplit";
import { PostingNotApproved } from "./postingErrors";
import { toRowState, toTransactionPreflight, type PostingOutputSnapshot } from "./snapshot";
import { verifyConvertOutcome, verifyCreatedRows, verifyLinkOutcome, verifyRestoreOutcome, verifyRevertOutcome, verifySplitOutcome, verifyUnlinkOutcome } from "./verify";

/**
 * The browser half of applying a posting (RD-084 P1.6 T125–T127; SC-018).
 *
 * Actual is reached from the browser, through the shared transport, so the
 * writes happen here. This executor accepts only a ticket the server issued
 * after recording the user's explicit approval (`status = applying`,
 * `decided_at` set); anything else throws `PostingNotApproved` before a single
 * read. Its only caller is the preview's **Apply this change** handler.
 *
 * Outcomes are honest about what Actual holds:
 *
 * - `applied`: written (or found by its marker) and verified;
 * - `failed`: nothing was written (preflight refused) or verification found a
 *   problem with what was written;
 * - `indeterminate`: the write may or may not have landed; only recovery or a
 *   reviewed decision resolves it, never a blind retry.
 */

export type ApplyTicketView = {
  posting: {
    id: string;
    status: unknown;
    decidedAt: string | null;
    idempotencyMarker: string | null;
    output: PostingOutputSnapshot;
  };
  mode: "apply" | "complete-link";
};

export type ExecutorContext = {
  transport: ActualBenchTransport;
  transferPayeeByAccount: Record<string, string>;
  offBudgetAccountIds: ReadonlySet<string>;
  liabilityAccountId: string;
  now?: () => string;
  /**
   * In a bulk apply on a connection with a batch write: new loan-side rows to mark cleared are
   * collected here and marked together at the end, instead of one settled write per split.
   */
  clearLater?: string[];
};

export type ExecutorOutcome =
  | { status: "applied"; actualIds: string[]; appliedAt: string; recovered?: boolean }
  | { status: "failed"; error: Record<string, unknown> }
  | { status: "indeterminate"; error: Record<string, unknown> };

/** SC-018: the executor runs only for a posting the user approved and the server started applying. */
export function assertApproved(ticket: ApplyTicketView): void {
  const { posting } = ticket;
  if (posting.decidedAt === null || posting.decidedAt === undefined) throw new PostingNotApproved();
  if (ticket.mode === "apply" && posting.status !== "applying") throw new PostingNotApproved();
  if (ticket.mode === "complete-link" && posting.status !== "indeterminate") throw new PostingNotApproved();
}

/** A readable message even when a transport throws a plain object (an HTTP error body). */
const message = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const e = error as { message?: unknown; error?: unknown; status?: unknown };
    const text = typeof e.message === "string" ? e.message : typeof e.error === "string" ? e.error : null;
    if (text) return typeof e.status === "number" ? `${text} (HTTP ${e.status})` : text;
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown error";
    }
  }
  return String(error);
};
/**
 * The transport refused before writing anything (expected-state difference or a
 * structural refusal). Recognised by name so this module keeps only type-only
 * imports from the Actual layer (the P1.3 zero-write guard).
 */
const beforeWrite = (error: unknown) => error instanceof Error && (error.name === "TransactionChangedError" || error.name === "TransactionStructureRefusedError");

function linkInput(output: Extract<PostingOutputSnapshot, { kind: "link" }>): LinkTransferInput {
  return { source: toTransactionPreflight(output.sourceBefore), counterpart: toTransactionPreflight(output.counterpartBefore), transferPayeeId: output.transferPayeeId };
}

async function read(transport: ActualBenchTransport, accountId: string, from: string, to?: string): Promise<SyncSourceTransaction[]> {
  return transport.listTransactionsForSync({ resolveNames: false, accountId, startDate: from, ...(to ? { endDate: to } : {}) });
}

export async function executeApprovedPosting(ticket: ApplyTicketView, ctx: ExecutorContext): Promise<ExecutorOutcome> {
  assertApproved(ticket);
  const output = ticket.posting.output;
  const now = ctx.now ?? (() => new Date().toISOString());
  switch (output.kind) {
    case "create": return applyCreate(output, ctx, now);
    case "restructure": return applyRestructure(output, ctx, now);
    case "link": return ticket.mode === "complete-link" ? completeLink(output, ctx, now) : applyLink(output, ctx, now);
    case "claim": return applyClaim(output, ctx, now);
    case "restore-split": return applyRestoreSplit(output, ctx, now);
    case "unlink": return applyUnlink(output, ctx, now);
    case "convert": return applyConvert(output, ctx, now);
    case "revert-convert": return applyRevert(output, ctx, now);
    case "adjust-split": return applyAdjustSplit(output, ctx, now);
  }
}

/** A write the transport refused before touching Actual, or one that may have landed. */
function writeError(stage: string, error: unknown): ExecutorOutcome {
  return beforeWrite(error)
    ? { status: "failed", error: { stage: "preflight", message: message(error), written: false } }
    : { status: "indeterminate", error: { stage, message: message(error) } };
}

/** T276: delete the split lines one at a time, restore the parent, verify it is exactly the original. */
async function applyRestoreSplit(output: Extract<PostingOutputSnapshot, { kind: "restore-split" }>, ctx: ExecutorContext, now: () => string): Promise<ExecutorOutcome> {
  if (!ctx.transport.restoreSplit) return { status: "failed", error: { stage: "capability", message: "This connection cannot undo a split.", written: false } };
  let result;
  try {
    result = await ctx.transport.restoreSplit({
      parent: toTransactionPreflight(output.parent),
      children: output.children.map(toTransactionPreflight),
      restoreTo: toRowState(output.restoreTo),
      counterpartAccountIds: output.counterpartAccountIds,
      recreatedCounterpart: output.recreatedCounterpart ? { accountId: output.recreatedCounterpart.accountId, expected: toRowState(output.recreatedCounterpart) } : null,
    });
  } catch (error) {
    return writeError("restore-split", error);
  }
  const issues = verifyRestoreOutcome(result);
  if (issues.length) return { status: "failed", error: { stage: "verify", issues, written: true } };
  return { status: "applied", actualIds: [result.parentId, ...(result.recreated?.id ? [result.recreated.id] : [])], appliedAt: now() };
}

/** T276: detach the lender's row, restore the source, verify both are exactly as before. */
async function applyUnlink(output: Extract<PostingOutputSnapshot, { kind: "unlink" }>, ctx: ExecutorContext, now: () => string): Promise<ExecutorOutcome> {
  if (!ctx.transport.unlinkTransfer) return { status: "failed", error: { stage: "capability", message: "This connection cannot undo a transfer link.", written: false } };
  let result;
  try {
    result = await ctx.transport.unlinkTransfer({
      source: toTransactionPreflight(output.source),
      counterpart: toTransactionPreflight(output.counterpart),
      sourceRestore: toRowState(output.sourceRestore),
      counterpartRestore: toRowState(output.counterpartRestore),
    });
  } catch (error) {
    return writeError("unlink", error);
  }
  const issues = verifyUnlinkOutcome(result);
  if (issues.length) return { status: "failed", error: { stage: "verify", issues, written: true } };
  return { status: "applied", actualIds: [output.source.id, output.counterpart.id], appliedAt: now() };
}

/** T277: the payment takes the loan's transfer payee; verify exactly one loan-side row. */
async function applyConvert(output: Extract<PostingOutputSnapshot, { kind: "convert" }>, ctx: ExecutorContext, now: () => string): Promise<ExecutorOutcome> {
  if (!ctx.transport.convertToTransfer) return { status: "failed", error: { stage: "capability", message: "This connection cannot convert a payment into a transfer.", written: false } };
  let result;
  try {
    result = await ctx.transport.convertToTransfer({ expected: toTransactionPreflight(output.before), transferPayeeId: output.transferPayeeId, counterpartAccountId: output.transferAccountId });
  } catch (error) {
    return writeError("convert", error);
  }
  let rows: SyncSourceTransaction[];
  try {
    rows = await read(ctx.transport, output.transferAccountId, output.before.date, output.before.date);
  } catch (error) {
    return { status: "indeterminate", error: { stage: "verify-read", message: message(error) } };
  }
  const issues = verifyConvertOutcome({ result, expected: output.expectedCounterpart, paymentId: output.before.id, counterpartAccountRows: rows });
  if (issues.length) return { status: "failed", error: { stage: "verify", issues, written: true } };
  return { status: "applied", actualIds: [output.before.id, result.transferId!], appliedAt: now() };
}

/** T277 undo: the payment's own payee back; verify it is exactly the original and the loan-side row is gone. */
async function applyRevert(output: Extract<PostingOutputSnapshot, { kind: "revert-convert" }>, ctx: ExecutorContext, now: () => string): Promise<ExecutorOutcome> {
  if (!ctx.transport.revertTransferConversion) return { status: "failed", error: { stage: "capability", message: "This connection cannot undo a transfer conversion.", written: false } };
  let result;
  try {
    result = await ctx.transport.revertTransferConversion({ converted: toTransactionPreflight(output.converted), counterpart: toTransactionPreflight(output.counterpart), restoreTo: toRowState(output.restoreTo) });
  } catch (error) {
    return writeError("revert-convert", error);
  }
  const issues = verifyRevertOutcome(result);
  if (issues.length) return { status: "failed", error: { stage: "verify", issues, written: true } };
  return { status: "applied", actualIds: [output.converted.id], appliedAt: now() };
}

/** T314: change the split's amounts in one update (ids kept), then verify the split and its loan-side row. */
async function applyAdjustSplit(output: Extract<PostingOutputSnapshot, { kind: "adjust-split" }>, ctx: ExecutorContext, now: () => string): Promise<ExecutorOutcome> {
  if (!ctx.transport.adjustSplitAmounts || !ctx.transport.inspectSplitAmounts) return { status: "failed", error: { stage: "capability", message: "This connection cannot change a split's amounts.", written: false } };
  try {
    await ctx.transport.adjustSplitAmounts(adjustWrite(output));
  } catch (error) {
    return writeError("adjust-split", error);
  }
  let state;
  try {
    state = await ctx.transport.inspectSplitAmounts(adjustInspection(output));
  } catch (error) {
    return { status: "indeterminate", error: { stage: "verify-read", message: message(error) } };
  }
  if (state !== "applied-exact") return { status: "failed", error: { stage: "verify", issues: [{ detail: state === "not-applied" ? "the split still has its old amounts" : "the split or its loan-side row does not hold the new amounts" }], written: true } };
  return { status: "applied", actualIds: [output.parent.id, ...output.children.map((c) => c.id)], appliedAt: now() };
}

/** T125: re-read, marker check, create, re-read, recover by marker, verify. */
async function applyCreate(output: Extract<PostingOutputSnapshot, { kind: "create" }>, ctx: ExecutorContext, now: () => string): Promise<ExecutorOutcome> {
  const from = output.operations.reduce((min, op) => (op.date < min ? op.date : min), output.operations[0]?.date ?? "0001-01-01");
  const to = output.operations.reduce((max, op) => (op.date > max ? op.date : max), from);
  const accounts = [...new Set(output.operations.map((op) => op.accountId))];
  let existing: SyncSourceTransaction[];
  try {
    existing = (await Promise.all(accounts.map((a) => read(ctx.transport, a, from, to)))).flat();
  } catch (error) {
    return { status: "failed", error: { stage: "preflight-read", message: message(error), written: false } };
  }
  const missing = output.operations.filter((op) => !existing.some((row) => row.importedId === op.importedId));
  if (missing.length) {
    try {
      await ctx.transport.createTransactionsForSync(missing.map((op) => ({
        accountId: op.accountId, date: op.date, amount: op.amountMinor, payeeId: op.payeeId, categoryId: op.categoryId,
        notes: op.notes, cleared: op.cleared, importedId: op.importedId,
      })));
    } catch (error) {
      return { status: "indeterminate", error: { stage: "create", message: message(error) } };
    }
  }
  let latest: SyncSourceTransaction[];
  try {
    latest = (await Promise.all(accounts.map((a) => read(ctx.transport, a, from, to)))).flat();
  } catch (error) {
    return { status: "indeterminate", error: { stage: "verify-read", message: message(error) } };
  }
  const verified = verifyCreatedRows({ operations: output.operations, latest, offBudgetAccountIds: ctx.offBudgetAccountIds });
  if (verified.issues.length) return { status: "failed", error: { stage: "verify", issues: verified.issues, written: true } };
  return { status: "applied", actualIds: verified.createdIds, appliedAt: now(), ...(missing.length === 0 ? { recovered: true } : {}) };
}

/** T126: expected-state preflight inside the transport, restructure, verify the exact post-state. */
async function applyRestructure(output: Extract<PostingOutputSnapshot, { kind: "restructure" }>, ctx: ExecutorContext, now: () => string): Promise<ExecutorOutcome> {
  if (!ctx.transport.restructureTransactionAsSplit) return { status: "failed", error: { stage: "capability", message: "This connection cannot restructure transactions.", written: false } };
  let result;
  try {
    result = await ctx.transport.restructureTransactionAsSplit({
      accountId: output.before.accountId,
      transactionId: output.before.id,
      expected: toTransactionPreflight(output.before),
      children: output.operations.map((c) => ({
        amount: c.amountMinor,
        categoryId: c.categoryId,
        payeeId: c.transferAccountId ? ctx.transferPayeeByAccount[c.transferAccountId] ?? null : c.payeeId,
        notes: c.notes,
      })),
      replaceCounterpart: output.replacesCounterpart
        ? { expected: toRowState(output.replacesCounterpart), sourceAccountTransferPayeeId: ctx.transferPayeeByAccount[output.before.accountId] ?? "" }
        : null,
      deferClearing: !!ctx.clearLater,
    });
  } catch (error) {
    return writeError("restructure", error);
  }
  if (result.clearLater) ctx.clearLater?.push(result.clearLater);
  let liabilityRows: SyncSourceTransaction[] = [];
  try {
    liabilityRows = await read(ctx.transport, ctx.liabilityAccountId, output.before.date, output.before.date);
  } catch (error) {
    return { status: "indeterminate", error: { stage: "verify-read", message: message(error) } };
  }
  const issues = verifySplitOutcome({ expected: output.expectedPostState, result, transferPayeeByAccount: ctx.transferPayeeByAccount, liabilityRows, before: output.before, replacedCounterpartId: output.replacesCounterpart?.id ?? null });
  if (issues.length) return { status: "failed", error: { stage: "verify", issues, written: true } };
  const counterparts = result.children.filter((c) => c.transferId).map((c) => c.transferId as string);
  return { status: "applied", actualIds: [result.parentId, ...result.children.map((c) => c.id), ...counterparts], appliedAt: now() };
}

async function verifyLink(output: Extract<PostingOutputSnapshot, { kind: "link" }>, ctx: ExecutorContext, result: Awaited<ReturnType<NonNullable<ActualBenchTransport["linkTransferCounterpart"]>>>, now: () => string): Promise<ExecutorOutcome> {
  let counterpartRows: SyncSourceTransaction[] = [];
  let sourceRows: SyncSourceTransaction[] = [];
  try {
    // Linking can move the lender's row to the payment's date; read up to the later of the two.
    const to = output.sourceBefore.date > output.counterpartBefore.date ? output.sourceBefore.date : output.counterpartBefore.date;
    counterpartRows = await read(ctx.transport, output.counterpartBefore.accountId, output.counterpartBefore.date < output.sourceBefore.date ? output.counterpartBefore.date : output.sourceBefore.date, to);
    sourceRows = await read(ctx.transport, output.sourceBefore.accountId, output.sourceBefore.date, to);
  } catch (error) {
    return { status: "indeterminate", error: { stage: "verify-read", message: message(error) } };
  }
  const issues = verifyLinkOutcome({
    result, expected: output.expectedPairState, counterpartBefore: output.counterpartBefore,
    counterpartNow: counterpartRows.find((r) => r.id === output.counterpartBefore.id) ?? null, sourceAccountRows: sourceRows,
  });
  if (issues.length) return { status: "failed", error: { stage: "verify", issues, written: true } };
  return { status: "applied", actualIds: [output.sourceBefore.id, output.counterpartBefore.id], appliedAt: now() };
}

/** T127: amount-equality preflight, two-call link, verify one liability-side row and the imported id kept. */
async function applyLink(output: Extract<PostingOutputSnapshot, { kind: "link" }>, ctx: ExecutorContext, now: () => string): Promise<ExecutorOutcome> {
  if (!ctx.transport.linkTransferCounterpart) return { status: "failed", error: { stage: "capability", message: "This connection cannot link transfers.", written: false } };
  let result;
  try {
    result = await ctx.transport.linkTransferCounterpart(linkInput(output));
  } catch (error) {
    return beforeWrite(error)
      ? { status: "failed", error: { stage: "preflight", message: message(error), written: false } }
      : { status: "indeterminate", error: { stage: "link", message: message(error) } };
  }
  return verifyLink(output, ctx, result, now);
}

/** T131: the user's explicit completion of an interrupted link; the second call only. */
async function completeLink(output: Extract<PostingOutputSnapshot, { kind: "link" }>, ctx: ExecutorContext, now: () => string): Promise<ExecutorOutcome> {
  if (!ctx.transport.completeTransferLink) return { status: "indeterminate", error: { stage: "capability", message: "This connection cannot complete transfer links." } };
  let result;
  try {
    result = await ctx.transport.completeTransferLink(linkInput(output));
  } catch (error) {
    return { status: "indeterminate", error: { stage: "complete-link", message: message(error) } };
  }
  return verifyLink(output, ctx, result, now);
}

/** A claim writes nothing to Actual: confirm the rows are still as previewed, then record the link. */
async function applyClaim(output: Extract<PostingOutputSnapshot, { kind: "claim" }>, ctx: ExecutorContext, now: () => string): Promise<ExecutorOutcome> {
  if (output.release) return { status: "applied", actualIds: output.rows.map((r) => r.id), appliedAt: now() };
  try {
    for (const row of output.rows) {
      const rows = await read(ctx.transport, row.accountId, row.date, row.date);
      const found = rows.flatMap((r) => [r, ...r.splitLines.map((l) => ({ ...r, ...l, id: l.id ?? "", amount: l.amount }))]).find((r) => r.id === row.id);
      if (!found || found.amount !== row.amountMinor) return { status: "failed", error: { stage: "preflight", message: "A claimed row changed in Actual. Preview again.", written: false } };
    }
  } catch (error) {
    return { status: "failed", error: { stage: "preflight-read", message: message(error), written: false } };
  }
  return { status: "applied", actualIds: output.rows.map((r) => r.id), appliedAt: now() };
}
