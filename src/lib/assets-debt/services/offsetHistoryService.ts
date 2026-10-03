import type { SyncSourceTransaction } from "@/lib/actual/transport";
import { DEFAULT_MAX_TRANSACTIONS, type LedgerReadTransport } from "../actual/ledgerPort";
import { addDays, compareDates } from "@/lib/financial-models/calendar/dates";
import { generateSchedule } from "@/lib/financial-models/calendar/schedule";
import type { FutureAssumption, LedgerEvent, LoanModelSnapshot } from "@/lib/financial-models/loan/model";

export type OffsetBalancePoint = { date: string; totalBalanceMinor: number; clearedBalanceMinor: number };
export type OffsetHistorySnapshot = { accountId: string; asOfDate: string; transactionCount: number; points: OffsetBalancePoint[] };
export type OffsetHistoryFailure = { accountId: string; reason: "account-not-found" | "incomplete-history" | "read-failed"; message: string };
export type OffsetHistoryResult = { ok: true; snapshots: OffsetHistorySnapshot[] } | { ok: false; failures: OffsetHistoryFailure[] };

export const OFFSET_HISTORY_MAX_TRANSACTIONS = DEFAULT_MAX_TRANSACTIONS;

export function deriveOffsetHistory(accountId: string, rows: readonly SyncSourceTransaction[], asOfDate: string, maxTransactions = OFFSET_HISTORY_MAX_TRANSACTIONS): OffsetHistorySnapshot {
  if (rows.length > maxTransactions) throw new RangeError(`More than ${maxTransactions} transactions were returned for ${accountId}; offset history is incomplete.`);
  const deltas = new Map<string, { total: number; cleared: number }>();
  for (const row of rows) {
    if (row.accountId !== accountId || row.isChild || compareDates(row.date, asOfDate) > 0) continue;
    const delta = deltas.get(row.date) ?? { total: 0, cleared: 0 };
    delta.total += row.amount;
    if (row.cleared || row.reconciled) delta.cleared += row.amount;
    if (!Number.isSafeInteger(delta.total) || !Number.isSafeInteger(delta.cleared)) throw new RangeError(`Offset history exceeds the safe integer range for ${accountId}.`);
    deltas.set(row.date, delta);
  }
  let totalBalanceMinor = 0;
  let clearedBalanceMinor = 0;
  const points = [...deltas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, delta]) => {
    totalBalanceMinor += delta.total;
    clearedBalanceMinor += delta.cleared;
    return { date, totalBalanceMinor, clearedBalanceMinor };
  });
  const last = points.at(-1);
  if (!last || last.date !== asOfDate) points.push({ date: asOfDate, totalBalanceMinor, clearedBalanceMinor });
  return { accountId, asOfDate, transactionCount: rows.length, points };
}

/** One complete, bounded, read-only transaction request per distinct account. */
export async function readOffsetHistories(transport: LedgerReadTransport, input: { accountIds: readonly string[]; asOfDate: string; maxTransactionsPerAccount?: number }): Promise<OffsetHistoryResult> {
  const accounts = await transport.getAccounts();
  const known = new Set(accounts.map((account) => account.id));
  const failures: OffsetHistoryFailure[] = [];
  const snapshots: OffsetHistorySnapshot[] = [];
  for (const accountId of [...new Set(input.accountIds)].sort()) {
    if (!known.has(accountId)) {
      failures.push({ accountId, reason: "account-not-found", message: "The mapped offset account is no longer in this budget." });
      continue;
    }
    try {
      const rows = await transport.listTransactionsForSync({ accountId, endDate: input.asOfDate });
      snapshots.push(deriveOffsetHistory(accountId, rows, input.asOfDate, input.maxTransactionsPerAccount));
    } catch (error) {
      const incomplete = error instanceof RangeError && error.message.includes("incomplete");
      failures.push({ accountId, reason: incomplete ? "incomplete-history" : "read-failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return failures.length ? { ok: false, failures } : { ok: true, snapshots };
}

function afterCutoff(assumption: FutureAssumption, cutoff: string): FutureAssumption | null {
  if (compareDates(assumption.date, cutoff) > 0) return assumption;
  if (!("recurrence" in assumption) || !assumption.recurrence) return null;
  const dates = generateSchedule(
    { frequency: assumption.recurrence.frequency, firstDate: assumption.date },
    { from: assumption.date, to: assumption.recurrence.until }
  );
  const next = dates.find((date) => compareDates(date, cutoff) > 0);
  return next ? { ...assumption, date: next } : null;
}

/**
 * Actual is authoritative through each snapshot's inclusive cutoff. Existing
 * assumptions remain persisted but only occurrences strictly after it enter
 * this projection. The engine continues to own ordering and offset math.
 */
export function mergeOffsetHistories(model: LoanModelSnapshot, snapshots: readonly OffsetHistorySnapshot[]): { model: LoanModelSnapshot; events: LedgerEvent[]; supersededAssumptions: number } {
  const byAccount = new Map(snapshots.map((snapshot) => [snapshot.accountId, snapshot]));
  const tracked = new Set(model.offsets.filter((link) => link.useActualBalance === true).map((link) => link.accountId));
  const events: LedgerEvent[] = [];
  for (const accountId of tracked) {
    const snapshot = byAccount.get(accountId);
    if (!snapshot) continue;
    for (const point of snapshot.points) events.push({ kind: "offset-balance", date: point.date, accountId, balanceMinor: point.totalBalanceMinor, clearedBalanceMinor: point.clearedBalanceMinor });
  }
  let supersededAssumptions = 0;
  const assumptions = model.assumptions.flatMap((assumption) => {
    if (!(assumption.kind === "offset-balance" || assumption.kind === "offset-deposit" || assumption.kind === "offset-withdrawal") || !tracked.has(assumption.accountId)) return [assumption];
    const cutoff = byAccount.get(assumption.accountId)?.asOfDate;
    if (!cutoff) return [assumption];
    const next = afterCutoff(assumption, cutoff);
    if (next !== assumption) supersededAssumptions += 1;
    return next ? [next] : [];
  });
  const offsets = model.offsets.map((link) => {
    const cutoff = link.useActualBalance === true ? byAccount.get(link.accountId)?.asOfDate : undefined;
    if (!cutoff || link.fundScheduledRepayments !== true) return link;
    const resume = addDays(cutoff, 1);
    const current = link.fundScheduledRepaymentsFrom;
    return { ...link, fundScheduledRepaymentsFrom: current && compareDates(current, resume) > 0 ? current : resume };
  });
  return { model: { ...model, offsets, assumptions }, events, supersededAssumptions };
}
