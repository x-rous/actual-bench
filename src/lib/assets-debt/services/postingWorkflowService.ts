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
import { planReversal } from "./planner/adjustments";
import { PostingNotApproved } from "./postingErrors";
import { buildPlanningContext, postingView, summarize, type PostingView } from "./proposalService";
import { compareRowToSnapshot, POSTING_INPUT_FORMAT_VERSION, type PostingOutputSnapshot, type RowSnapshot } from "./snapshot";

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

function rowsToCheck(output: PostingOutputSnapshot): RowSnapshot[] {
  switch (output.kind) {
    case "restructure": return [output.before];
    case "link": return [output.sourceBefore, output.counterpartBefore];
    case "claim": return output.release ? [] : output.rows;
    case "create": return [];
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
    supersedePosting(db, postingId, input.decidedAt);
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
  return [];
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
      if (output.kind === "claim" && output.release) {
        for (const link of listPostingTransactionLinks(db, posting.reversalOf)) deleteDebtTransactionLink(db, link.id);
      }
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
  const pending = findReversalProposal(db, postingId);
  if (pending) return postingView(pending);
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
