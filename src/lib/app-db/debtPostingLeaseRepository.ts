import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import { getFinancialPosting, listSubjectPostings, markPostingIndeterminate } from "./financialPostingRepository";
import type { SqliteDatabase } from "./types";

export const POSTING_LEASE_MS = 5 * 60_000;
type Lease = { token: string; expires_at: string };

export function hasPostingLease(db: SqliteDatabase, id: string, now = new Date().toISOString()): boolean {
  const lease = db.prepare("SELECT token, expires_at FROM debt_posting_leases WHERE posting_id = ?").get<Lease>(id);
  return !!lease && lease.expires_at > now;
}

export function acquirePostingLease(db: SqliteDatabase, id: string, now = new Date().toISOString()): string {
  const token = generateId();
  const changed = db.prepare("INSERT INTO debt_posting_leases (posting_id, token, expires_at) VALUES (?, ?, ?) ON CONFLICT(posting_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at WHERE debt_posting_leases.expires_at <= ?")
    .run(id, token, new Date(Date.parse(now) + POSTING_LEASE_MS).toISOString(), now);
  if (!changed.changes) throw new AppDbValidationError("This change is already running in another operation.");
  return token;
}

export function renewPostingLease(db: SqliteDatabase, id: string, token: string, now = new Date().toISOString()): void {
  const posting = getFinancialPosting(db, id);
  if (!posting || !["applying", "indeterminate"].includes(String(posting.status))) throw new AppDbValidationError("This change is no longer running.");
  const changed = db.prepare("UPDATE debt_posting_leases SET expires_at = ? WHERE posting_id = ? AND token = ?")
    .run(new Date(Date.parse(now) + POSTING_LEASE_MS).toISOString(), id, token);
  if (!changed.changes) throw new AppDbValidationError("The execution lease is no longer owned by this operation.");
}

export function releasePostingLease(db: SqliteDatabase, id: string): void {
  db.prepare("DELETE FROM debt_posting_leases WHERE posting_id = ?").run(id);
}

/** Abandoned executions become checkable, never automatically retried. Renewed leases protect long batches. */
export function recoverAbandonedPostings(db: SqliteDatabase, debtId: string, now = new Date().toISOString()): void {
  db.transaction(() => {
    for (const posting of listSubjectPostings(db, "debt", debtId)) {
      if (posting.status !== "applying" || hasPostingLease(db, posting.id, now)) continue;
      const lease = db.prepare("SELECT token, expires_at FROM debt_posting_leases WHERE posting_id = ?").get<Lease>(posting.id);
      if (!lease && Date.parse(now) - Date.parse(posting.updatedAt) < POSTING_LEASE_MS) continue;
      markPostingIndeterminate(db, posting.id, { stage: "execution-interrupted", message: "The execution stopped reporting progress. Check Actual before deciding what to do next." }, now);
      releasePostingLease(db, posting.id);
    }
  })();
}

/** Reject outcomes from an execution superseded by recovery or another owner. */
export function assertPostingLease(db: SqliteDatabase, id: string, token: string): void {
  const lease = db.prepare("SELECT token, expires_at FROM debt_posting_leases WHERE posting_id = ?").get<Lease>(id);
  if (!lease || lease.token !== token) throw new AppDbValidationError("This execution no longer owns the posting. Refresh and check Actual.");
}
