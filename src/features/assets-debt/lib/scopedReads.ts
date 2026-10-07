import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import type { MatchingHistorySnapshot } from "@/lib/assets-debt/actual/ledgerPort";

/**
 * What a refresh reads from Actual (owner decision 2026-10-07): the loan account is the main
 * ledger and is read in full; the other side is read only where it matters, so years of unrelated
 * bank activity are never scanned or sent anywhere.
 *
 * - Transfers into or out of the loan account: their paying side, on their own days (whatever
 *   account they came from).
 * - Payments Bench already applied: on their days, so Bench can tell whether Actual still holds them.
 * - Repayments that are not transfers (a rule that says what they look like): the repayment account
 *   from a little before the last split through today, where unsplit ones can still be.
 */

export type ReadRange = { accountId: string; from: string; to: string };

/** Merge only overlaps/containment after planning. Do not widen the selected date union. */
export function consolidateReadRanges(ranges: readonly ReadRange[]): ReadRange[] {
  const sorted = ranges.map((range) => ({ ...range })).sort((a, b) =>
    a.accountId.localeCompare(b.accountId) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const merged: ReadRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && previous.accountId === range.accountId && range.from <= previous.to) {
      if (range.to > previous.to) previous.to = range.to;
    } else merged.push(range);
  }
  return merged;
}

const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const gap = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Ranges per account: the given days, merged when within a few days of each other, plus any whole ranges. */
export function planBankReads(input: {
  loanRows: readonly SyncSourceTransaction[];
  liabilityAccountId: string;
  /** Transfer payee id → the account it points at. */
  accountByTransferPayee: Readonly<Record<string, string>>;
  applied: ReadonlyArray<{ accountId: string; date: string }>;
  paymentAccountId: string | null;
  /** The repayment rule says what non-transfer repayments look like. */
  ruleIdentifies: boolean;
  lastSplitDate: string | null;
  window: { from: string; to: string };
}): ReadRange[] {
  const { window } = input;
  const lo = shift(window.from, -31);
  const hi = shift(window.to, 31);
  const days = new Map<string, Set<string>>();
  const add = (accountId: string, date: string) => {
    if (accountId === input.liabilityAccountId || date < lo || date > hi) return;
    days.set(accountId, (days.get(accountId) ?? new Set()).add(date));
  };
  for (const row of input.loanRows) {
    if (!row.transferId || !row.payeeId) continue;
    const other = input.accountByTransferPayee[row.payeeId];
    if (other) add(other, row.date);
  }
  for (const a of input.applied) add(a.accountId, a.date);
  const ranges: ReadRange[] = [];
  for (const [accountId, set] of days) {
    const sorted = [...set].sort();
    let start = sorted[0];
    let end = sorted[0];
    for (const d of sorted.slice(1)) {
      if (gap(end, d) <= 3) end = d;
      else { ranges.push({ accountId, from: start, to: end }); start = d; end = d; }
    }
    ranges.push({ accountId, from: start, to: end });
  }
  if (input.ruleIdentifies && input.paymentAccountId && input.paymentAccountId !== input.liabilityAccountId) {
    const from = input.lastSplitDate ? shift(input.lastSplitDate, -60) : lo;
    ranges.push({ accountId: input.paymentAccountId, from: from < lo ? lo : from, to: hi });
  }
  return consolidateReadRanges(ranges);
}

/** Read the ranges (one call each) into one snapshot per account, each row once. */
export async function readRanges(transport: Pick<ActualBenchTransport, "listTransactionsForSync">, ranges: readonly ReadRange[]): Promise<MatchingHistorySnapshot[]> {
  const byAccount = new Map<string, Map<string, SyncSourceTransaction>>();
  for (const r of ranges) {
    const rows = await transport.listTransactionsForSync({ accountId: r.accountId, startDate: r.from, endDate: r.to });
    const into = byAccount.get(r.accountId) ?? new Map<string, SyncSourceTransaction>();
    for (const row of rows) into.set(row.id, row);
    byAccount.set(r.accountId, into);
  }
  return [...byAccount].map(([accountId, rows]) => ({ accountId, transactions: [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) }));
}
