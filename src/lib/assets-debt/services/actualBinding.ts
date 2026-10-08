import { deleteDebtTransactionLink, listPostingTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import { closeReplacedFailure, listSubjectPostings, markPostingChangedInActual } from "@/lib/app-db/financialPostingRepository";
import { AppDbValidationError } from "@/lib/app-db/errors";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { PostingOutputSnapshot, RowSnapshot } from "./snapshot";
import { settledPaymentOf } from "./repaymentAlignment";

/**
 * Applied changes follow Actual (owner decision 2026-10-07): Actual is the truth, Bench's record of
 * what it applied is not. On every read each applied repayment change is checked against the rows
 * Actual holds now. Still there as applied (including repayment date and economic structure): it
 * keeps counting. Edited, unsplit or deleted in Actual: it stops counting (marked changed in
 * Actual, its links released) and the period is planned again from what Actual has, so a split
 * edited there is recorded with Actual's figures, an unsplit payment needs splitting again, and a
 * deleted one leaves its due date missed. Nothing is written to Actual.
 *
 * A row is only judged missing after a complete lookup by its stable id (`covered`); absence from
 * the original date range alone cannot distinguish a moved row from a deleted one.
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

export type Covered = (accountId: string, date: string, id?: string) => boolean;
export type ChangedInActual = { postingId: string; periodKey: string; detail: string };

const CHECKED_KINDS = new Set(["repayment-split", "repayment-link", "interest-charge", "fee-charge", "interest-link"]);

type Noun = "payment" | "charge" | "lender-row";
type Expectation = {
  parent: { id: string; accountId: string; date: string; payeeId?: string | null; categoryId?: string | null; transferId?: string | null };
  lines: Array<{ id: string; amountMinor: number; payeeId?: string | null; categoryId?: string | null; transferId?: string | null; transferAccountId?: string | null }> | null;
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
function expectationsOf(output: PostingOutputSnapshot, actualIds: readonly string[] | null, payees: Record<string, string>): Expectation[] {
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
      { parent: { id: output.sourceBefore.id, accountId: output.sourceBefore.accountId, date: output.sourceBefore.date, payeeId: output.transferPayeeId }, lines: null, amountMinor: output.sourceBefore.amountMinor, linkedTo: counterpart },
      { parent: counterpart, lines: null, amountMinor: null, noun: "lender-row" },
    ];
  }
  const one = expectationOf(output, actualIds, payees);
  return one ? [one] : [];
}

function expectationOf(output: PostingOutputSnapshot, actualIds: readonly string[] | null, payees: Record<string, string>): Expectation | null {
  switch (output.kind) {
    case "restructure": {
      // Recorded as [parent, ...split lines, ...loan-side rows Actual made].
      const ids = actualIds ?? [];
      const childIds = ids.slice(1, 1 + output.operations.length);
      if (childIds.length !== output.operations.length) return null;
      return { parent: { id: ids[0] ?? output.before.id, accountId: output.before.accountId, date: output.before.date }, lines: output.operations.map((op, i) => ({ id: childIds[i], amountMinor: op.amountMinor, categoryId: op.categoryId, payeeId: op.transferAccountId ? payees[op.transferAccountId] : op.payeeId, transferAccountId: op.transferAccountId })), amountMinor: output.before.amountMinor };
    }
    case "claim": {
      if (output.release) return null;
      if (output.recordedSplit) {
        const split = output.recordedSplit;
        const p = split.parent;
        return { parent: { id: p.id, accountId: p.accountId, date: p.date }, lines: split.children.map((c) => ({ id: c.id, amountMinor: c.amountMinor, payeeId: c.payeeId, categoryId: c.categoryId, transferId: c.transferId, transferAccountId: split.counterpart && split.counterpart.id === c.transferId ? split.counterpart.accountId : undefined })), amountMinor: p.amountMinor };
      }
      const row = output.rows[0];
      const counterpart = row?.transferId ? output.rows.find((other) => other.id === row.transferId) : null;
      return row ? { parent: { id: row.parentId ?? row.id, accountId: row.accountId, date: row.date, ...(row.parentId ? {} : { payeeId: row.payeeId, categoryId: row.categoryId, transferId: row.transferId }) }, lines: null, amountMinor: row.amountMinor, transferTo: counterpart?.accountId } : null;
    }
    case "adjust-split":
      if (!output.edit) return null;
      return { parent: { id: output.parent.id, accountId: output.parent.accountId, date: output.parent.date }, lines: output.amounts.map((a) => {
        const child = output.children.find((row) => row.id === a.id);
        return { ...child, id: a.id, amountMinor: a.amountMinor, transferAccountId: output.counterpart && output.counterpart.id === child?.transferId ? output.counterpart.accountId : undefined };
      }), amountMinor: output.parent.amountMinor };
    case "convert":
      return { parent: { id: output.before.id, accountId: output.before.accountId, date: output.before.date, payeeId: output.transferPayeeId }, lines: null, amountMinor: output.before.amountMinor, transferTo: output.transferAccountId };
    default:
      return null;
  }
}

/** Why Actual no longer holds the change, or null when it does (or the read cannot tell). */
function divergence(expect: Expectation, rows: ReadonlyMap<string, RowSnapshot>, covered: Covered): string | null {
  const noun = expect.noun ?? "payment";
  const parent = rows.get(expect.parent.id);
  if (!parent) return covered(expect.parent.accountId, expect.parent.date, expect.parent.id) ? MISSING[noun] : null;
  if (parent.accountId !== expect.parent.accountId) return "the transaction was moved to another account in Actual";
  if (noun === "payment" && parent.date !== expect.parent.date) return "the repayment date changed in Actual; review its interest allocation";
  if (expect.transferTo) {
    const counterpart = parent.transferId ? rows.get(parent.transferId) : null;
    if (!parent.transferId || (counterpart && (counterpart.accountId !== expect.transferTo || counterpart.transferId !== parent.id || counterpart.amountMinor !== -parent.amountMinor || counterpart.date !== parent.date))) return "the payment’s transfer destination changed in Actual";
    if (!counterpart && covered(expect.transferTo, parent.date, parent.transferId)) return "the loan-side transfer was removed in Actual";
  }
  if (expect.linkedTo && parent.transferId !== expect.linkedTo.id) {
    // Unlinked in Actual; or linked elsewhere. Only judged when the read saw the other row's side.
    if (parent.transferId || covered(expect.linkedTo.accountId, expect.linkedTo.date, expect.linkedTo.id)) return "the transfer link to the lender's row was removed in Actual";
  }
  if ((expect.parent.payeeId !== undefined && parent.payeeId !== expect.parent.payeeId) || (expect.parent.categoryId !== undefined && parent.categoryId !== expect.parent.categoryId) || (expect.parent.transferId !== undefined && parent.transferId !== expect.parent.transferId)) return "the repayment’s payee, category or transfer changed in Actual";
  if (expect.lines) {
    if (expect.amountMinor !== null && parent.amountMinor !== expect.amountMinor) return AMOUNT[noun];
    const lines = [...rows.values()].filter((r) => r.isChild && r.parentId === parent.id);
    if (!parent.isParent || lines.length === 0) return "the payment is no longer split in Actual";
    const same = lines.length === expect.lines.length && expect.lines.every((l) => lines.some((r) => r.id === l.id && r.amountMinor === l.amountMinor));
    if (!same) return "the split's amounts were changed in Actual";
    for (const expected of expect.lines) {
      const line = lines.find((row) => row.id === expected.id)!;
      if (line.accountId !== parent.accountId) return "a split line was moved to another account in Actual";
      if (line.date !== parent.date) return "a split line’s date changed in Actual; review its interest allocation";
      if ((expected.payeeId !== undefined && line.payeeId !== expected.payeeId) || (expected.categoryId !== undefined && line.categoryId !== expected.categoryId) || (expected.transferId !== undefined && line.transferId !== expected.transferId)) return "the split’s payee, category or transfer changed in Actual";
      if (expected.transferAccountId) {
        const counterpart = line.transferId ? rows.get(line.transferId) : null;
        if (!line.transferId || (counterpart && (counterpart.accountId !== expected.transferAccountId || counterpart.transferId !== line.id || counterpart.amountMinor !== -line.amountMinor || counterpart.date !== line.date))) return "the principal transfer destination changed in Actual";
        if (!counterpart && covered(expected.transferAccountId, line.date, line.transferId)) return "the principal transfer counterpart was removed in Actual";
      }
    }
    return null;
  }
  if (parent.isChild || expect.amountMinor === null) return null;
  if (parent.amountMinor !== expect.amountMinor) return AMOUNT[noun];
  return null;
}

export function releaseChangedInActual(db: SqliteDatabase, debtId: string, rows: ReadonlyMap<string, RowSnapshot>, covered: Covered, now = new Date().toISOString(), transferPayees: Record<string, string> = {}): ChangedInActual[] {
  const out: ChangedInActual[] = [];
  const postings = listSubjectPostings(db, "debt", debtId);
  const laterChanges = postings.filter((p) => p.status === "applied" && !p.reversalOf).sort((a, b) => (a.appliedAt ?? a.updatedAt).localeCompare(b.appliedAt ?? b.updatedAt));
  const amountEdits = new Map<string, { owner: string; at: string; amountMinor: number }>();
  const linkedLines = new Map<string, { owner: string; at: string }>();
  for (const posting of laterChanges) {
    const output = JSON.parse(posting.outputSnapshotJson) as PostingOutputSnapshot;
    const at = posting.appliedAt ?? posting.updatedAt;
    if (output.kind === "adjust-split" && output.edit) for (const amount of output.amounts) amountEdits.set(amount.id, { owner: posting.id, at, amountMinor: amount.amountMinor });
    if (output.kind === "link") linkedLines.set(output.sourceBefore.id, { owner: posting.id, at });
  }
  for (const posting of postings) {
    if (posting.status !== "applied" || posting.reversalOf || !CHECKED_KINDS.has(String(posting.postingKind))) continue;
    const expects = expectationsOf(JSON.parse(posting.outputSnapshotJson) as PostingOutputSnapshot, posting.actualIds, transferPayees);
    // A later approved Bench edit supersedes those fields in the earlier split snapshot. Transfer
    // links retain their own expectations so unlinking releases the link, not the original split.
    const appliedAt = posting.appliedAt ?? posting.updatedAt;
    for (const expect of expects) {
      for (const line of expect.lines ?? []) {
        const amount = amountEdits.get(line.id);
        if (amount && amount.owner !== posting.id && amount.at >= appliedAt) line.amountMinor = amount.amountMinor;
        const linked = linkedLines.get(line.id);
        if (linked && linked.owner !== posting.id && linked.at >= appliedAt) {
          line.payeeId = undefined;
          line.transferId = undefined;
          line.transferAccountId = undefined;
        }
      }
    }
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
 * Failed changes stop asking for action once a replacement is applied. Reversal attempts need
 * the same original posting and action; repayments can also be identified by their payment when
 * their due date was realigned. A matching balance alone never resolves a failed write.
 * (owner report 2026-10-07: a failed payoff stayed under "Needs action" after the loan was paid
 * off). Returns how many were closed.
 */
export function closeSettledFailures(db: SqliteDatabase, debtId: string, now = new Date().toISOString()): number {
  const postings = listSubjectPostings(db, "debt", debtId);
  const family = (kind: string) => (kind === "repayment-split" || kind === "repayment-link" ? "repayment" : kind);
  const outputs = new Map(postings.map((posting) => [posting.id, JSON.parse(posting.outputSnapshotJson) as PostingOutputSnapshot]));
  const paymentId = (output: PostingOutputSnapshot) => output.kind === "link"
    ? output.sourceBefore.parentId ?? output.sourceBefore.id
    : settledPaymentOf(output)?.paymentId;
  let closed = 0;
  for (const failed of postings) {
    if (failed.status !== "failed") continue;
    const failedOutput = outputs.get(failed.id)!;
    const settled = postings.some((p) => {
      if (p.id === failed.id || p.status !== "applied" || !p.appliedAt || p.appliedAt < failed.updatedAt) return false;
      const replacementOutput = outputs.get(p.id)!;
      if (failed.reversalOf) {
        // Undo and Unsplit may target the same repayment but have different effects.
        return p.reversalOf === failed.reversalOf && replacementOutput.kind === failedOutput.kind;
      }
      if (p.reversalOf || family(String(p.postingKind)) !== family(String(failed.postingKind))) return false;
      if (p.periodKey === failed.periodKey) return true;
      const failedPayment = family(String(failed.postingKind)) === "repayment" ? paymentId(failedOutput) : null;
      return !!failedPayment && failedPayment === paymentId(replacementOutput);
    });
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
