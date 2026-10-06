import { listSubjectPostings } from "@/lib/app-db/financialPostingRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import type { PostingOutputSnapshot } from "./snapshot";

/**
 * Whether a loan is paid off (owner decision 2026-10-07). Worked out, never stored: the loan has an
 * applied payoff (a repayment split that cleared it, or on a loan that records interest as its own
 * transaction, the transfer that did) that has not been undone. Its status stays as
 * it is, so the user archives it when they choose, and undoing the payoff reopens it by itself.
 */

export type PaidOff = { paidDate: string; dueDate: string; postingId: string };

export function paidOffState(db: SqliteDatabase, debtId: string): PaidOff | null {
  let found: PaidOff | null = null;
  for (const posting of listSubjectPostings(db, "debt", debtId)) {
    if (posting.status !== "applied" || (posting.postingKind !== "repayment-split" && posting.postingKind !== "repayment-link")) continue;
    const output = JSON.parse(posting.outputSnapshotJson) as PostingOutputSnapshot;
    if ((output.kind !== "restructure" && output.kind !== "claim") || !output.payoff) continue;
    if (!found || output.payoff.paidDate > found.paidDate) found = { paidDate: output.payoff.paidDate, dueDate: posting.periodKey, postingId: posting.id };
  }
  return found;
}
