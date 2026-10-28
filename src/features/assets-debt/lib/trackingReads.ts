import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import type { RuleCondition } from "@/lib/transactions/conditions";
import { actualUnitsToMinor, DEFAULT_MAX_TRANSACTIONS } from "@/lib/assets-debt/actual/ledgerPort";
import { startTiming } from "./debugTiming";

/**
 * What a loan's tracking reads from Actual, in as few calls as possible (design spec 06 §5.1):
 * - a sync, so the figures are current;
 * - the whole loan account (refused above 5,000 rows rather than cut short);
 * - in one grouped query, the paying side of every transfer into the loan account (each on its own day) and the
 *   accounts the payment rules name, from the tracking window on;
 * - the account balances, once, to check the loan account was read completely;
 * - payees once per connection, refetched only when a transfer payee is missing.
 */

export type TrackingReads = {
  loanRows: SyncSourceTransaction[];
  bankRows: SyncSourceTransaction[];
  transferPayeeByAccount: Record<string, string>;
  /** Actual's own balance of the loan account matches the rows read (null when it couldn't be checked). */
  complete: boolean | null;
  readAt: string;
};

type PayeeMap = { byAccount: Record<string, string>; accountOfPayee: Record<string, string> };
const payeeCache = new WeakMap<ActualBenchTransport, PayeeMap>();

async function payees(transport: ActualBenchTransport, refresh = false): Promise<PayeeMap> {
  const cached = payeeCache.get(transport);
  if (cached && !refresh) return cached;
  const list = await transport.getPayees();
  const map: PayeeMap = { byAccount: {}, accountOfPayee: {} };
  for (const p of list as Array<{ id: string; transferAccountId?: string | null }>) {
    if (!p.transferAccountId) continue;
    map.byAccount[p.transferAccountId] = p.id;
    map.accountOfPayee[p.id] = p.transferAccountId;
  }
  payeeCache.set(transport, map);
  return map;
}

/** The accounts a payment rule can find payments in: the ones it names, or every open budget account when it names none. */
export function ruleAccounts(rules: readonly { conditions: readonly RuleCondition[] }[], openAccountIds: readonly string[], loanAccountId: string): string[] {
  if (!rules.length) return [];
  const named = rules.map((r) => r.conditions.filter((c) => c.field === "account" && c.operator === "equals").map((c) => c.value));
  const accounts = named.some((ids) => ids.length === 0) ? openAccountIds : named.flat();
  return [...new Set(accounts)].filter((id) => id !== loanAccountId);
}

export class TrackingReadError extends Error {}

export async function readTracking(transport: ActualBenchTransport, input: {
  loanAccountId: string;
  /** Rows on or after this date matter for payments (the day before the first tracked installment's period). */
  from: string;
  today: string;
  ruleAccountIds: readonly string[];
  sync?: boolean;
}): Promise<TrackingReads> {
  const timing = startTiming("loan tracking read");
  if (input.sync !== false) { await transport.sync(); timing.step("sync"); }
  const [loanRows, balances] = await Promise.all([
    transport.listTransactionsForSync({ accountId: input.loanAccountId }),
    transport.getAccountBalances().catch(() => null),
  ]);
  timing.step("loan account");
  if (loanRows.length > DEFAULT_MAX_TRANSACTIONS) throw new TrackingReadError(`The loan account has more than ${DEFAULT_MAX_TRANSACTIONS} transactions, more than Bench reads at once.`);
  let map = await payees(transport);
  const transfers = loanRows.filter((r) => r.transferId && r.date >= input.from);
  // A transfer from an account whose payee Bench hasn't seen: the payee list is out of date.
  if (transfers.some((r) => r.payeeId && !map.accountOfPayee[r.payeeId])) map = await payees(transport, true);
  timing.step("payees");
  const ranges = new Map<string, { accountId: string; from: string; to: string }>();
  for (const r of transfers) {
    const accountId = r.payeeId ? map.accountOfPayee[r.payeeId] : undefined;
    if (accountId) ranges.set(`${accountId}:${r.date}`, { accountId, from: r.date, to: r.date });
  }
  for (const accountId of input.ruleAccountIds) ranges.set(`${accountId}:rule`, { accountId, from: input.from, to: input.today });
  let bankRows: SyncSourceTransaction[] = [];
  if (ranges.size) {
    const list = [...ranges.values()];
    if (transport.queryTransactionsForSync) bankRows = await transport.queryTransactionsForSync({ ranges: list });
    else {
      // One read per account over the dates it needs.
      for (const accountId of [...new Set(list.map((r) => r.accountId))]) {
        const mine = list.filter((r) => r.accountId === accountId);
        const from = mine.reduce((m, r) => (r.from < m ? r.from : m), "9999-12-31");
        const to = mine.reduce((m, r) => (r.to > m ? r.to : m), "0000-01-01");
        bankRows.push(...(await transport.listTransactionsForSync({ accountId, startDate: from, endDate: to })));
      }
    }
  }
  timing.step("paying side");
  timing.end();
  let complete: boolean | null = null;
  const whole = balances?.get(input.loanAccountId);
  if (typeof whole === "number") {
    try {
      const sum = loanRows.filter((r) => !r.isChild && (transport.mode !== "browser-api" || r.date <= input.today)).reduce((s, r) => s + r.amount, 0);
      complete = actualUnitsToMinor(whole) === sum;
    } catch { complete = null; }
  } else if (balances && loanRows.length === 0) complete = true;
  return { loanRows, bankRows, transferPayeeByAccount: map.byAccount, complete, readAt: new Date().toISOString() };
}
