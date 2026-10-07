import { getDebt } from "@/lib/app-db/debtRepository";
import { insertDebtTransactionLink, listDebtTransactionLinks, listPostingTransactionLinks, deleteDebtTransactionLink } from "@/lib/app-db/debtTransactionLinkRepository";
import { AppDbValidationError } from "@/lib/app-db/errors";
import {
  beginApplyingPosting,
  decidePosting,
  findReversalProposal,
  getFinancialPosting,
  markPostingApplied,
  markPostingFailed,
  markPostingIndeterminate,
  markPostingReversed,
  reproposeIndeterminatePosting,
  supersedePosting,
  upsertProposal,
} from "@/lib/app-db/financialPostingRepository";
import type { DebtTransactionLinkRole, FinancialPostingRecord, SqliteDatabase } from "@/lib/app-db/types";
import type { AccountDirectory } from "../actual/ledgerPort";
import { planReversal, planUnsplit } from "./planner/adjustments";
import { PostingNotApproved } from "./postingErrors";
import { buildPlanningContext, postingView, summarize, type PostingView } from "./proposalService";
import { compareRowToSnapshot, OVERRIDE_NO_REASON_MINOR, POSTING_INPUT_FORMAT_VERSION, type PostingInputSnapshot, type PostingOutputSnapshot, type RowSnapshot, type SplitOverride } from "./snapshot";

/**
 * The server half of applying a posting (RD-084 P1.6 T125–T136; SC-018).
 *
 * Actual is reached from the browser (`getTransport`), and the app DB only from
 * the server, so applying a posting is split in two, like Bank Statement
 * Reconciliation's apply:
 *
 * 1. `approveAndBeginApply` runs on the user's explicit **Apply this change**
 *    request. It re-runs preflight against the rows the browser re-read just
 *    before the request, records the decision (`approved`, `decided_at`), and
 *    moves the posting to `applying`. Only then does it hand back a ticket.
 * 2. The browser's apply executor (`applyService.ts`) refuses anything but such
 *    a ticket (`PostingNotApproved`), writes through the shared transport,
 *    verifies, and reports the outcome to `recordApplyOutcome`.
 *
 * Nothing else moves a posting toward Actual: no background job, timer,
 * preview or reproduction calls these functions.
 */

export { PostingNotApproved };

export class PreflightRefused extends Error {
  readonly differences: string[];
  constructor(differences: string[]) {
    super(`Actual changed since the preview (${differences.join(", ")}). Preview again.`);
    this.name = "PreflightRefused";
    this.differences = differences;
  }
}

export type ApplyTicket = {
  posting: PostingView;
  mode: "apply" | "complete-link";
};

const known = (value: unknown): value is string => typeof value === "string";

function outputOf(posting: FinancialPostingRecord): PostingOutputSnapshot {
  return JSON.parse(posting.outputSnapshotJson) as PostingOutputSnapshot;
}

/** The rows a posting's preflight compares, as they must still be when it is applied (FR-162). */
export function rowsToCheck(output: PostingOutputSnapshot): RowSnapshot[] {
  switch (output.kind) {
    case "restructure": return output.replacesCounterpart ? [output.before, output.replacesCounterpart] : [output.before];
    case "link": return [output.sourceBefore, output.counterpartBefore];
    case "claim": return output.release ? [] : output.rows;
    case "create": return [];
    case "restore-split": return [output.parent, ...output.children];
    case "unlink": return [output.source, output.counterpart];
    case "convert": return [output.before];
    case "revert-convert": return [output.converted, output.counterpart];
    case "adjust-split": return [output.parent, ...output.children, ...(output.counterpart ? [output.counterpart] : [])];
  }
}

/** Server-side preflight (FR-005, FR-162): bound account, unchanged configuration, unchanged rows. */
export function preflightPosting(db: SqliteDatabase, posting: FinancialPostingRecord, fresh: RowSnapshot[]): string[] {
  const debt = getDebt(db, posting.subjectId);
  if (!debt) return ["the debt no longer exists"];
  const differences: string[] = [];
  if (debt.currentRevision !== posting.configRevision) differences.push("the loan configuration changed");
  const output = outputOf(posting);
  if (output.kind === "create") {
    for (const op of output.operations) {
      if (op.accountId !== debt.liabilityAccountId) differences.push("the target account is no longer this loan's account");
    }
  }
  const byId = new Map(fresh.map((row) => [row.id, row]));
  for (const before of rowsToCheck(output)) {
    for (const diff of compareRowToSnapshot(before, byId.get(before.id) ?? null)) differences.push(`${diff.field} of ${diff.rowId}`);
  }
  return differences;
}

/**
 * The user's explicit Apply. Records approval and starts applying, after a
 * server-side preflight; a changed target supersedes the proposal instead.
 */
export function approveAndBeginApply(db: SqliteDatabase, postingId: string, input: { fresh: RowSnapshot[]; decidedAt: string }): ApplyTicket {
  const posting = getFinancialPosting(db, postingId);
  if (!posting) throw new AppDbValidationError("Posting not found");
  if (posting.classification === "blocked" || !known(posting.classification)) throw new AppDbValidationError("A blocked proposal cannot be applied; resolve it in Actual first");
  if (posting.status !== "proposed") throw new AppDbValidationError(`A ${known(posting.status) ? posting.status : "unrecognised"} posting cannot be applied`);
  const differences = preflightPosting(db, posting, input.fresh);
  if (differences.length) {
    supersedePosting(db, postingId, input.decidedAt, "actual-changed");
    throw new PreflightRefused(differences);
  }
  const ticket = db.transaction(() => {
    decidePosting(db, postingId, "approved", input.decidedAt);
    return beginApplyingPosting(db, postingId, input.decidedAt);
  })();
  return { posting: postingView(ticket), mode: "apply" };
}

/**
 * Completing a half-linked pair (T131) is an Actual write, so it is offered
 * only for an indeterminate link posting the user already approved, and only
 * on their explicit request.
 */
export function beginCompleteLink(db: SqliteDatabase, postingId: string): ApplyTicket {
  const posting = getFinancialPosting(db, postingId);
  if (!posting) throw new AppDbValidationError("Posting not found");
  if (posting.status !== "indeterminate" || posting.decidedAt === null) throw new PostingNotApproved("Only an approved, interrupted transfer link can be completed.");
  if (outputOf(posting).kind !== "link") throw new AppDbValidationError("Only a transfer link can be completed");
  return { posting: postingView(posting), mode: "complete-link" };
}

export type ApplyOutcome =
  | { status: "applied"; actualIds: string[]; appliedAt: string; recovered?: boolean }
  | { status: "failed"; error: Record<string, unknown> }
  | { status: "indeterminate"; error: Record<string, unknown> }
  | { status: "not-found"; reason: { code: string; text: string } };

function linkRoles(posting: FinancialPostingRecord, output: PostingOutputSnapshot, actualIds: string[]): Array<{ id: string; parentId: string | null; role: DebtTransactionLinkRole }> {
  const kind = known(posting.postingKind) ? posting.postingKind : "";
  if (output.kind === "claim" && !output.release) {
    if (output.role === "lender-interest-charge") return output.rows.map((r) => ({ id: r.id, parentId: r.parentId, role: "lender-interest-charge" }));
    return output.rows.map((r, index) => ({ id: r.id, parentId: r.parentId, role: index === 0 ? "repayment" : "lender-repayment-row" }));
  }
  if (output.kind === "restructure" && kind === "repayment-split") {
    const principalIndex = output.operations.findIndex((c) => c.economicKind === "principal");
    const childId = actualIds[principalIndex + 1];
    return childId ? [{ id: childId, parentId: actualIds[0] ?? null, role: "repayment" }] : [];
  }
  if (output.kind === "link") {
    return [
      { id: output.sourceBefore.id, parentId: output.sourceBefore.parentId, role: "repayment" },
      { id: output.counterpartBefore.id, parentId: null, role: "lender-repayment-row" },
    ];
  }
  if (output.kind === "convert") return [{ id: output.before.id, parentId: null, role: "repayment" }];
  // T314: the split keeps its ids, so its transfer part is the repayment as before. Its undo links nothing new.
  if (output.kind === "adjust-split" && output.edit) {
    const principal = output.children.find((c) => c.transferId);
    return principal ? [{ id: principal.id, parentId: output.parent.id, role: "repayment" }] : [];
  }
  return [];
}

/**
 * Apply a claim in one step (rev 4 speed): a claim writes nothing to Actual, so after the same
 * approval and preflight as any apply, the server records it as applied with its links at once.
 * Still only from the user's explicit Apply (SC-018).
 */
export function approveAndRecordClaim(db: SqliteDatabase, postingId: string, input: { fresh: RowSnapshot[]; now: string }): PostingView {
  const posting = getFinancialPosting(db, postingId);
  if (!posting) throw new AppDbValidationError("Posting not found");
  const output = outputOf(posting);
  if (output.kind !== "claim" || output.release) throw new AppDbValidationError("Only a claim that writes nothing to Actual can be recorded in one step");
  return db.transaction(() => {
    approveAndBeginApply(db, postingId, { fresh: input.fresh, decidedAt: input.now });
    return recordApplyOutcome(db, postingId, { status: "applied", actualIds: output.rows.map((r) => r.id), appliedAt: input.now }, input.now);
  })();
}

/** The browser reports what happened in Actual; the server records it and its links. */
export function recordApplyOutcome(db: SqliteDatabase, postingId: string, outcome: ApplyOutcome, now = new Date().toISOString()): PostingView {
  const posting = getFinancialPosting(db, postingId);
  if (!posting) throw new AppDbValidationError("Posting not found");
  const fromIndeterminate = posting.status === "indeterminate";
  return db.transaction(() => {
    if (outcome.status === "failed") return postingView(markPostingFailed(db, postingId, outcome.error, now));
    if (outcome.status === "indeterminate") return postingView(markPostingIndeterminate(db, postingId, outcome.error, now));
    if (outcome.status === "not-found") return postingView(reproposeIndeterminatePosting(db, postingId, outcome.reason, now));
    const applied = markPostingApplied(db, postingId, { actualIds: outcome.actualIds, appliedAt: outcome.appliedAt, fromIndeterminate });
    const output = outputOf(posting);
    const existing = new Set(listDebtTransactionLinks(db, posting.subjectId).map((l) => `${l.actualTransactionId}:${known(l.role) ? l.role : ""}`));
    for (const link of linkRoles(posting, output, outcome.actualIds)) {
      if (existing.has(`${link.id}:${link.role}`)) continue;
      insertDebtTransactionLink(db, {
        debtId: posting.subjectId, budgetSyncId: posting.budgetSyncId, actualTransactionId: link.id, actualParentId: link.parentId,
        role: link.role, periodKey: posting.periodKey, linkSource: "posting", postingId,
      }, now);
    }
    if (posting.reversalOf) {
      // The reversed posting's rows are gone or restored: none of its links may outlive it, so no
      // Bench reference points at a deleted Actual id (a re-created counterpart is in actualIds).
      for (const link of listPostingTransactionLinks(db, posting.reversalOf)) deleteDebtTransactionLink(db, link.id);
      markPostingReversed(db, posting.reversalOf, now);
    }
    return postingView(applied);
  })();
}

export function declinePosting(db: SqliteDatabase, postingId: string, decidedAt: string): PostingView {
  return postingView(decidePosting(db, postingId, "declined", decidedAt));
}

/**
 * Undo: create a compensating reversal **proposal** (FR-184, T132). It writes
 * nothing to Actual and needs the user's own approval before it is applied.
 */
/** "Unsplit" a split already in Actual that Bench recorded: a Review proposal on that row (owner decision 2026-10-07). */
export function proposeUnsplit(
  db: SqliteDatabase,
  postingId: string,
  input: { accountDirectory: AccountDirectory; transferPayees: Record<string, string>; today: string },
  now = new Date().toISOString()
): PostingView {
  const original = getFinancialPosting(db, postingId);
  if (!original) throw new AppDbValidationError("Posting not found");
  if (original.status !== "applied") throw new AppDbValidationError("Record the split first; then it can be unsplit");
  const output = outputOf(original);
  if (output.kind !== "claim" || !output.recordedSplit) throw new AppDbValidationError("Only a split already in Actual can be unsplit; use Undo for a split Bench made");
  const pending = findReversalProposal(db, postingId);
  if (pending && pending.status !== "proposed") return postingView(pending);
  if (pending) supersedePosting(db, pending.id, now, "newer-undo");
  const built = buildPlanningContext(db, original.subjectId, {
    from: input.today, to: input.today, today: input.today, accountDirectory: input.accountDirectory, transferPayees: input.transferPayees,
    capabilities: { canRestructure: true, canVerifyTransferLinks: true },
  });
  if (!built.ok) throw new AppDbValidationError("notFound" in built ? "Debt not found" : built.blocked.message);
  const planned = planUnsplit(built.ctx, summarize(original));
  const result = upsertProposal(db, {
    budgetSyncId: original.budgetSyncId, subjectKind: "debt", subjectId: original.subjectId,
    postingKind: "reversal", periodKey: planned.periodKey, generation: planned.generation,
    configRevision: built.ctx.debt.currentRevision, inputFormatVersion: POSTING_INPUT_FORMAT_VERSION,
    inputSnapshot: planned.inputSnapshot, engineVersions: planned.engineVersions, outputSnapshot: planned.outputSnapshot,
    classification: planned.classification, reasons: planned.reasons, idempotencyMarker: null, reversalOf: original.id,
  }, now);
  return postingView(result.posting);
}

export function proposeReversal(
  db: SqliteDatabase,
  postingId: string,
  input: { accountDirectory: AccountDirectory; transferPayees: Record<string, string>; today: string },
  now = new Date().toISOString()
): PostingView {
  const original = getFinancialPosting(db, postingId);
  if (!original) throw new AppDbValidationError("Posting not found");
  if (original.status !== "applied") throw new AppDbValidationError("Only an applied posting can be reversed");
  if (original.reversalOf) throw new AppDbValidationError("A reversal is not reversed; apply a new correction instead");
  // An Undo already approved or under way is the one; an undecided proposal is planned again, since
  // what blocked it (for example a link that had to be undone first) may be resolved now.
  const pending = findReversalProposal(db, postingId);
  if (pending && pending.status !== "proposed") return postingView(pending);
  if (pending) supersedePosting(db, pending.id, now, "newer-undo");
  const built = buildPlanningContext(db, original.subjectId, {
    from: input.today, to: input.today, today: input.today, accountDirectory: input.accountDirectory, transferPayees: input.transferPayees,
    capabilities: { canRestructure: true, canVerifyTransferLinks: true },
  });
  if (!built.ok) throw new AppDbValidationError("notFound" in built ? "Debt not found" : built.blocked.message);
  const planned = planReversal(built.ctx, summarize(original));
  const result = upsertProposal(db, {
    budgetSyncId: original.budgetSyncId, subjectKind: "debt", subjectId: original.subjectId,
    postingKind: "reversal", periodKey: planned.periodKey, generation: planned.generation,
    configRevision: built.ctx.debt.currentRevision, inputFormatVersion: POSTING_INPUT_FORMAT_VERSION,
    inputSnapshot: planned.inputSnapshot, engineVersions: planned.engineVersions, outputSnapshot: planned.outputSnapshot,
    classification: planned.classification, reasons: planned.reasons, idempotencyMarker: planned.marker, reversalOf: original.id,
  }, now);
  return postingView(result.posting);
}

/**
 * The user's edit of a proposed repayment split's interest (T291; FR-069d). Principal stays the
 * residual, so the lines still sum to the payment. Up to ±1 minor unit from the calculation needs
 * no reason; more needs one. The edit becomes a new Review proposal that records the calculated
 * value, the edited value and the reason; entering the calculated value again removes the edit.
 * Later months build on the edited principal. Nothing is written to Actual here.
 */
export function overrideRepaymentSplit(
  db: SqliteDatabase,
  postingId: string,
  input: { interestMinor: number; reason?: string | null },
  now = new Date().toISOString()
): PostingView {
  const posting = getFinancialPosting(db, postingId);
  if (!posting) throw new AppDbValidationError("Posting not found");
  if (posting.status !== "proposed") throw new AppDbValidationError("Only an undecided proposal can be edited");
  if (posting.postingKind !== "repayment-split") throw new AppDbValidationError("Only a repayment split's amounts can be edited");
  if (posting.classification === "blocked") throw new AppDbValidationError("A blocked proposal cannot be edited; resolve it first");
  const output = outputOf(posting);
  if ((output.kind === "claim" && output.recordedSplit) || output.kind === "adjust-split") return overrideRecordedSplit(db, posting, output, input, now);
  if (output.kind !== "restructure") throw new AppDbValidationError("Only a repayment split's amounts can be edited");
  const interestMinor = input.interestMinor;
  if (!Number.isSafeInteger(interestMinor) || interestMinor < 0) throw new AppDbValidationError("The interest must be zero or more, in whole minor units");
  const interestIndex = output.operations.findIndex((c) => c.economicKind === "interest");
  const principalIndex = output.operations.findIndex((c) => c.economicKind === "principal");
  if (interestIndex < 0 || principalIndex < 0) throw new AppDbValidationError("This split has no interest line to edit");
  const sign = output.before.amountMinor < 0 ? -1 : 1;
  const calculated = output.override?.calculatedInterestMinor ?? Math.abs(output.operations[interestIndex].amountMinor);
  const reason = input.reason?.trim() || null;
  if (Math.abs(interestMinor - calculated) > OVERRIDE_NO_REASON_MINOR && !reason) {
    throw new AppDbValidationError("Give a short reason for a change of more than one minor unit");
  }
  if (reason && reason.length > 200) throw new AppDbValidationError("Keep the reason under 200 characters");
  const others = output.operations.reduce((sum, c, i) => (i === interestIndex || i === principalIndex ? sum : sum + Math.abs(c.amountMinor)), 0);
  const principal = Math.abs(output.before.amountMinor) - others - interestMinor;
  if (principal <= 0) throw new AppDbValidationError("The interest is larger than the payment allows; principal would not be positive");

  const operations = output.operations.map((c, i) => (i === interestIndex ? { ...c, amountMinor: sign * interestMinor } : i === principalIndex ? { ...c, amountMinor: sign * principal } : c));
  const override: SplitOverride | null = interestMinor === calculated ? null : { calculatedInterestMinor: calculated, interestMinor, reason };
  const oldPrincipal = Math.abs(output.operations[principalIndex].amountMinor);
  const { override: _previous, ...rest } = output;
  void _previous;
  const nextOutput: PostingOutputSnapshot = {
    ...rest,
    operations,
    expectedPostState: { ...output.expectedPostState, children: operations },
    components: operations.map((c) => ({ kind: c.economicKind, amountMinor: Math.abs(c.amountMinor) })),
    closing: output.closing ? { ...output.closing, principalMinor: output.closing.principalMinor + oldPrincipal - principal } : null,
    ...(override ? { override } : {}),
  };
  const inputSnapshot = JSON.parse(posting.inputSnapshotJson) as PostingInputSnapshot;
  const { overrideInterestMinor: _a, calculatedInterestMinor: _b, overrideReason: _c, ...parameters } = inputSnapshot.parameters;
  void _a; void _b; void _c;
  const observed = inputSnapshot.observedRepayments;
  const nextInput: PostingInputSnapshot = {
    ...inputSnapshot,
    parameters: { ...parameters, ...(override ? { overrideInterestMinor: override.interestMinor, calculatedInterestMinor: override.calculatedInterestMinor, overrideReason: override.reason } : {}) },
    ...(observed
      ? { observedRepayments: { ...observed, repayments: observed.repayments.map((r, i) => (i === observed.repayments.length - 1 ? withApplied(r, override?.interestMinor) : r)) } }
      : {}),
  };
  const fmt = (minor: number, digits = 2) => (minor / 10 ** digits).toFixed(digits);
  const digits = getDebt(db, posting.subjectId)?.currencyMinorDigits ?? 2;
  const reasons = posting.reasons.filter((r) => r.code !== "edited-split");
  if (override) reasons.push({ code: "edited-split", text: `Edited: calculated interest ${fmt(calculated, digits)}, your value ${fmt(interestMinor, digits)}${reason ? ` (${reason})` : ""}.` });
  const result = upsertProposal(db, {
    budgetSyncId: posting.budgetSyncId, subjectKind: "debt", subjectId: posting.subjectId,
    postingKind: "repayment-split", periodKey: posting.periodKey, generation: posting.generation,
    configRevision: posting.configRevision, inputFormatVersion: POSTING_INPUT_FORMAT_VERSION,
    inputSnapshot: nextInput, engineVersions: posting.engineVersions, outputSnapshot: nextOutput,
    // An edited proposal is always Review (owner refinement 2).
    classification: "review", reasons, idempotencyMarker: posting.idempotencyMarker, reversalOf: null,
  }, now);
  return postingView(result.posting, result.reused);
}

/**
 * The user's edit of a split already in Actual (T314). Actual's figures are the starting point; a
 * value other than Actual's interest becomes an adjust-split proposal that rewrites the split's
 * amounts in Actual (always Review), and Actual's own value again goes back to recording the split
 * as it is. More than one minor unit from Bench's calculation needs a reason, as for Bench's splits.
 */
function overrideRecordedSplit(
  db: SqliteDatabase,
  posting: FinancialPostingRecord,
  output: Extract<PostingOutputSnapshot, { kind: "claim" | "adjust-split" }>,
  input: { interestMinor: number; reason?: string | null },
  now: string
): PostingView {
  const recorded = output.kind === "claim" ? output.recordedSplit! : output.recordedSplit;
  const children = output.kind === "claim" ? recorded.children : output.children;
  const counterpart = output.kind === "claim" ? recorded.counterpart ?? null : output.counterpart;
  const parent = recorded.parent;
  const principalChild = children.find((c) => c.transferId);
  const interestChild = children.find((c) => c !== principalChild);
  if (children.length !== 2 || !principalChild || !interestChild) throw new AppDbValidationError("Only a split of one principal transfer and one interest line can be edited here; change it in Actual instead");
  const payment = Math.abs(parent.amountMinor);
  const actualInterest = payment - Math.abs(principalChild.amountMinor);
  const calculated = recorded.calculatedInterestMinor;
  const interestMinor = input.interestMinor;
  if (!Number.isSafeInteger(interestMinor) || interestMinor < 0) throw new AppDbValidationError("The interest must be zero or more, in whole minor units");
  const principalMinor = payment - interestMinor;
  if (principalMinor <= 0) throw new AppDbValidationError("The interest is larger than the payment allows; principal would not be positive");
  if (interestMinor === 0) throw new AppDbValidationError("A split line cannot be zero; remove the split in Actual instead");
  const reason = input.reason?.trim() || null;
  if (Math.abs(interestMinor - calculated) > OVERRIDE_NO_REASON_MINOR && interestMinor !== actualInterest && !reason) {
    throw new AppDbValidationError("Give a short reason for a change of more than one minor unit");
  }
  if (reason && reason.length > 200) throw new AppDbValidationError("Keep the reason under 200 characters");
  const digits = getDebt(db, posting.subjectId)?.currencyMinorDigits ?? 2;
  const fmt = (minor: number) => (minor / 10 ** digits).toFixed(digits);
  const previousPrincipal = recorded.principalMinor;
  const closing = output.closing ? { ...output.closing, principalMinor: output.closing.principalMinor + previousPrincipal - principalMinor } : null;
  const nextRecorded = { ...recorded, children, counterpart, principalMinor, interestMinor };
  const head = { format: output.format, version: output.version };
  const reasons = posting.reasons.filter((r) => !["edited-split", "recorded-split-differs", "recorded-split", "adjust-split"].includes(r.code));
  let nextOutput: PostingOutputSnapshot;
  if (interestMinor === actualInterest) {
    nextOutput = { ...head, kind: "claim", rows: [principalChild], role: "repayment", closing, recordedSplit: nextRecorded };
    if (Math.abs(interestMinor - calculated) > OVERRIDE_NO_REASON_MINOR) reasons.push({ code: "recorded-split-differs", text: `Edited in Actual: calculated interest ${fmt(calculated)}, Actual has ${fmt(interestMinor)}.` });
  } else {
    if (!counterpart) throw new AppDbValidationError("Bench cannot see the loan-side row of this split's transfer part; widen the period shown and refresh first");
    const sign = parent.amountMinor < 0 ? -1 : 1;
    nextOutput = {
      ...head, kind: "adjust-split", parent, children, counterpart,
      amounts: [{ id: principalChild.id, amountMinor: sign * principalMinor }, { id: interestChild.id, amountMinor: sign * interestMinor }],
      recordedSplit: nextRecorded,
      edit: { actualInterestMinor: actualInterest, calculatedInterestMinor: calculated, interestMinor, reason },
      closing,
    };
    reasons.push({ code: "edited-split", text: `Edited: Actual has interest ${fmt(actualInterest)}, calculated ${fmt(calculated)}, your value ${fmt(interestMinor)}${reason ? ` (${reason})` : ""}.` });
    reasons.push({ code: "adjust-split", text: "Changes the amounts of a split already in Actual, so it needs your review." });
  }
  const inputSnapshot = JSON.parse(posting.inputSnapshotJson) as PostingInputSnapshot;
  const observed = inputSnapshot.observedRepayments;
  const nextInput: PostingInputSnapshot = {
    ...inputSnapshot,
    ...(observed ? { observedRepayments: { ...observed, repayments: observed.repayments.map((r, i) => (i === observed.repayments.length - 1 ? withApplied(r, interestMinor) : r)) } } : {}),
  };
  const result = upsertProposal(db, {
    budgetSyncId: posting.budgetSyncId, subjectKind: "debt", subjectId: posting.subjectId,
    postingKind: "repayment-split", periodKey: posting.periodKey, generation: posting.generation,
    configRevision: posting.configRevision, inputFormatVersion: POSTING_INPUT_FORMAT_VERSION,
    inputSnapshot: nextInput, engineVersions: posting.engineVersions, outputSnapshot: nextOutput,
    classification: "review", reasons, idempotencyMarker: null, reversalOf: null,
  }, now);
  return postingView(result.posting, result.reused);
}

function withApplied<T extends { appliedInterestMinor?: number }>(entry: T, applied: number | undefined): T {
  const { appliedInterestMinor: _old, ...rest } = entry;
  void _old;
  return (applied === undefined ? rest : { ...rest, appliedInterestMinor: applied }) as T;
}

