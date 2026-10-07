import { deleteDebtTransactionLink, listPostingTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import { closeReplacedFailure, listSubjectPostings, markPostingChangedInActual } from "@/lib/app-db/financialPostingRepository";
import { AppDbValidationError } from "@/lib/app-db/errors";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { PostingOutputSnapshot, RowSnapshot } from "./snapshot";

/**
 * Applied changes follow Actual (owner decision 2026-10-07): Actual is the truth, Bench's record of
 * what it applied is not. On every read each applied repayment change is checked against the rows
 * Actual holds now. Still there as applied (amounts per line unchanged; a moved date is fine): it
 * keeps counting. Edited, unsplit or deleted in Actual: it stops counting (marked changed in
 * Actual, its links released) and the period is planned again from what Actual has, so a split
 * edited there is recorded with Actual's figures, an unsplit payment needs splitting again, and a
 * deleted one leaves its due date missed. Nothing is written to Actual.
 *
 * A row is only judged missing when the read covered where it was (`covered`); otherwise the change
 * keeps counting until a read can tell.
 *
 * Loans that record interest as its own transaction, and lender feeds, are bound the same way:
 * - an interest or fee charge Bench added stops counting when it is deleted in Actual (an amount
 *   edited there is Actual's figure and the loan balance already shows it, so it keeps counting);
 * - a lender's row Bench took as the interest charge or the repayment stops counting when it is
 *   deleted or its amount changes;
 * - a transfer link Bench made to the lender's row stops counting when the link or either row is
 *   gone.
 * When Bench would then add or link it again, that waits for Review (see the planner's finalize).
 */

export type Covered = (accountId: string, date: string) => boolean;
export type ChangedInActual = { postingId: string; periodKey: string; detail: string };

const CHECKED_KINDS = new Set(["repayment-split", "repayment-link", "interest-charge", "fee-charge", "interest-link"]);

type Noun = "payment" | "charge" | "lender-row";
type Expectation = {
  parent: { id: string; accountId: string; date: string };
  lines: Array<{ id: string; amountMinor: number }> | null;
  /** null: only that the row is still there. */
  amountMinor: number | null;
  transferTo?: string | null;
  /** The row must still be a transfer linked to this one. */
  linkedTo?: { id: string; accountId: string; date: string };
  noun?: Noun;
};

const MISSING: Record<Noun, string> = {
  payment: "the payment is no longer in Actual",
  charge: "the charge Bench added is no longer in Actual",
  "lender-row": "the lender's row is no longer in Actual",
};
const AMOUNT: Record<Noun, string> = {
  payment: "the payment's amount was changed in Actual",
  charge: "the charge's amount was changed in Actual",
  "lender-row": "the lender's row's amount was changed in Actual",
};

/** What Actual must still hold for an applied change to keep counting (each row). */
function expectationsOf(output: PostingOutputSnapshot, actualIds: readonly string[] | null): Expectation[] {
  if (output.kind === "create") {
    // Recorded as the created rows, in the order of the operations.
    const ids = actualIds ?? [];
    if (ids.length !== output.operations.length) return [];
    return output.operations.map((op, i) => ({ parent: { id: ids[i], accountId: op.accountId, date: op.date }, lines: null, amountMinor: null, noun: "charge" as const }));
  }
  if (output.kind === "claim" && !output.release && output.role !== "repayment") {
    return output.rows.map((row) => ({ parent: { id: row.parentId ?? row.id, accountId: row.accountId, date: row.date }, lines: null, amountMinor: row.parentId ? null : row.amountMinor, noun: "lender-row" as const }));
  }
  if (output.kind === "link") {
    const counterpart = { id: output.counterpartBefore.id, accountId: output.counterpartBefore.accountId, date: output.counterpartBefore.date };
    return [
      { parent: { id: output.sourceBefore.id, accountId: output.sourceBefore.accountId, date: output.sourceBefore.date }, lines: null, amountMinor: output.sourceBefore.amountMinor, linkedTo: counterpart },
      { parent: counterpart, lines: null, amountMinor: null, noun: "lender-row" },
    ];
  }
  const one = expectationOf(output, actualIds);
  return one ? [one] : [];
}

function expectationOf(output: PostingOutputSnapshot, actualIds: readonly string[] | null): Expectation | null {
  switch (output.kind) {
    case "restructure": {
      // Recorded as [parent, ...split lines, ...loan-side rows Actual made].
      const ids = actualIds ?? [];
      const childIds = ids.slice(1, 1 + output.operations.length);
      if (childIds.length !== output.operations.length) return null;
      return { parent: { id: ids[0] ?? output.before.id, accountId: output.before.accountId, date: output.before.date }, lines: output.operations.map((op, i) => ({ id: childIds[i], amountMinor: op.amountMinor })), amountMinor: output.before.amountMinor };
    }
    case "claim": {
      if (output.release) return null;
      if (output.recordedSplit) {
        const p = output.recordedSplit.parent;
        return { parent: { id: p.id, accountId: p.accountId, date: p.date }, lines: output.recordedSplit.children.map((c) => ({ id: c.id, amountMinor: c.amountMinor })), amountMinor: p.amountMinor };
      }
      const row = output.rows[0];
      return row ? { parent: { id: row.parentId ?? row.id, accountId: row.accountId, date: row.date }, lines: null, amountMinor: row.amountMinor } : null;
    }
    case "adjust-split":
      if (!output.edit) return null;
      return { parent: { id: output.parent.id, accountId: output.parent.accountId, date: output.parent.date }, lines: output.amounts.map((a) => ({ id: a.id, amountMinor: a.amountMinor })), amountMinor: output.parent.amountMinor };
    case "convert":
      return { parent: { id: output.before.id, accountId: output.before.accountId, date: output.before.date }, lines: null, amountMinor: output.before.amountMinor, transferTo: output.transferAccountId };
    default:
      return null;
  }
}

/** Why Actual no longer holds the change, or null when it does (or the read cannot tell). */
function divergence(expect: Expectation, rows: ReadonlyMap<string, RowSnapshot>, covered: Covered): string | null {
  const noun = expect.noun ?? "payment";
  const parent = rows.get(expect.parent.id);
  if (!parent) return covered(expect.parent.accountId, expect.parent.date) ? MISSING[noun] : null;
  if (expect.linkedTo && parent.transferId !== expect.linkedTo.id) {
    // Unlinked in Actual; or linked elsewhere. Only judged when the read saw the other row's side.
    if (parent.transferId || covered(expect.linkedTo.accountId, expect.linkedTo.date)) return "the transfer link to the lender's row was removed in Actual";
  }
  if (expect.lines) {
    const lines = [...rows.values()].filter((r) => r.isChild && r.parentId === parent.id);
    if (!parent.isParent || lines.length === 0) return "the payment is no longer split in Actual";
    const same = lines.length === expect.lines.length && expect.lines.every((l) => lines.some((r) => r.id === l.id && r.amountMinor === l.amountMinor));
    if (!same) return "the split's amounts were changed in Actual";
    return null;
  }
  if (parent.isChild || expect.amountMinor === null) return null;
  if (parent.amountMinor !== expect.amountMinor) return AMOUNT[noun];
  return null;
}

export function releaseChangedInActual(db: SqliteDatabase, debtId: string, rows: ReadonlyMap<string, RowSnapshot>, covered: Covered, now = new Date().toISOString()): ChangedInActual[] {
  const out: ChangedInActual[] = [];
  for (const posting of listSubjectPostings(db, "debt", debtId)) {
    if (posting.status !== "applied" || posting.reversalOf || !CHECKED_KINDS.has(String(posting.postingKind))) continue;
    const expects = expectationsOf(JSON.parse(posting.outputSnapshotJson) as PostingOutputSnapshot, posting.actualIds);
    const detail = expects.map((e) => divergence(e, rows, covered)).find((d): d is string => d !== null);
    if (!detail) continue;
    try {
      db.transaction(() => {
        for (const link of listPostingTransactionLinks(db, posting.id)) deleteDebtTransactionLink(db, link.id);
        markPostingChangedInActual(db, posting.id, detail, now);
      })();
      out.push({ postingId: posting.id, periodKey: posting.periodKey, detail });
    } catch (error) {
      // Another tab released it at the same moment: already done.
      if (!(error instanceof AppDbValidationError)) throw error;
    }
  }
  return out;
}

/**
 * Failed changes stop asking for action once another change for the same due date is applied
 * (owner report 2026-10-07: a failed payoff stayed under "Needs action" after the loan was paid
 * off). Returns how many were closed.
 */
export function closeSettledFailures(db: SqliteDatabase, debtId: string, now = new Date().toISOString()): number {
  const postings = listSubjectPostings(db, "debt", debtId);
  const family = (kind: string) => (kind === "repayment-split" || kind === "repayment-link" ? "repayment" : kind);
  let closed = 0;
  for (const failed of postings) {
    if (failed.status !== "failed") continue;
    const settled = postings.some((p) => p.id !== failed.id && p.status === "applied" && !p.reversalOf && p.periodKey === failed.periodKey
      && family(String(p.postingKind)) === family(String(failed.postingKind)));
    if (!settled) continue;
    try {
      closeReplacedFailure(db, failed.id, now);
      closed++;
    } catch (error) {
      if (!(error instanceof AppDbValidationError)) throw error;
    }
  }
  return closed;
}
