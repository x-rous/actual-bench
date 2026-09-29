import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";

/**
 * The Assets & Debt ledger port, read side (RD-084 P1.3; FR-006, FR-012,
 * FR-022, research R-09).
 *
 * Everything RD-084 reads from Actual goes through here, over the shared
 * transport, in either mode. The port is typed against a read-only slice of
 * the transport: there is no write surface in P1.3, so a configuration save
 * cannot reach one. Write adapters arrive with P1.6, behind gate G2.
 *
 * Interactive Actual access happens in the browser (`getTransport`), so the
 * editor reads the budget's account directory here and sends it with a save;
 * the configuration service validates the debt against it.
 */

export type LedgerReadTransport = Pick<ActualBenchTransport, "getAccounts" | "getAccountBalances" | "getCategoryGroups" | "listTransactionsForSync">;

/** The only transport methods the port may call. Tests assert nothing else is touched. */
export const LEDGER_READ_METHODS = ["getAccounts", "getAccountBalances", "getCategoryGroups", "listTransactionsForSync"] as const;

export type DirectoryAccount = { id: string; name: string; offBudget: boolean; closed: boolean };
export type DirectoryCategory = { id: string; name: string; groupName: string; isIncome: boolean; hidden: boolean };

/** A budget's accounts and categories as read from Actual, labelled with the budget they came from. */
export type AccountDirectory = {
  budgetSyncId: string;
  accounts: DirectoryAccount[];
  categories: DirectoryCategory[];
};

export type BudgetStatus = "on-budget" | "off-budget";

export async function readAccountDirectory(transport: LedgerReadTransport, budgetSyncId: string): Promise<AccountDirectory> {
  const [accounts, groups] = await Promise.all([transport.getAccounts(), transport.getCategoryGroups()]);
  const groupNames = new Map(groups.groups.map((g) => [g.id, g.name]));
  return {
    budgetSyncId,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, offBudget: a.offBudget, closed: a.closed })),
    categories: groups.categories.map((c) => ({ id: c.id, name: c.name, groupName: groupNames.get(c.groupId) ?? "", isIncome: c.isIncome, hidden: c.hidden })),
  };
}

export function budgetStatus(account: Pick<DirectoryAccount, "offBudget">): BudgetStatus {
  return account.offBudget ? "off-budget" : "on-budget";
}

/** A movement between these accounts crosses the budget boundary and needs a category on the on-budget side (FR-011a). */
export function crossesBudgetBoundary(a: Pick<DirectoryAccount, "offBudget">, b: Pick<DirectoryAccount, "offBudget">): boolean {
  return a.offBudget !== b.offBudget;
}

/**
 * The positive debt magnitude of a ledger balance (FR-022): calculations use
 * the magnitude, and the sign convention applies only at the Actual boundary.
 */
export function toDebtMagnitude(balanceMinor: number, signConvention: "negative-is-debt" | "positive-is-debt"): number {
  return signConvention === "negative-is-debt" ? -balanceMinor : balanceMinor;
}

export function fromDebtMagnitude(magnitudeMinor: number, signConvention: "negative-is-debt" | "positive-is-debt"): number {
  return signConvention === "negative-is-debt" ? -magnitudeMinor : magnitudeMinor;
}

/**
 * `getAccountBalances` reports decimal currency units. Actual stores every
 * amount as integer hundredths, so the conversion is exact for any balance
 * Actual can hold; a value that is not a whole number of hundredths is refused.
 */
export function actualUnitsToMinor(value: number): number {
  const minor = Math.round(value * 100);
  if (!Number.isSafeInteger(minor) || Math.abs(minor / 100 - value) > 1e-9 * Math.max(1, Math.abs(value))) {
    throw new RangeError(`Not a whole number of hundredths: ${value}`);
  }
  return minor;
}

export const DEFAULT_MAX_TRANSACTIONS = 5_000;

export type DatedBalance =
  | { ok: true; accountId: string; date: string; balanceMinor: number; transactionsRead: number }
  | { ok: false; accountId: string; date: string; reason: "account-not-found" | "too-many-transactions"; message: string };

const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * An account's total balance at the end of `date`, derived locally (R-09):
 * the current balance minus every transaction after `date`. One bounded read
 * per account; a read larger than `maxTransactions` is refused rather than
 * truncated, because a partial sum would be a wrong balance.
 */
export async function readDatedBalance(
  transport: LedgerReadTransport,
  input: { accountId: string; date: string; maxTransactions?: number }
): Promise<DatedBalance> {
  const { accountId, date } = input;
  const balances = await transport.getAccountBalances();
  const current = balances.get(accountId);
  if (current === undefined) return { ok: false, accountId, date, reason: "account-not-found", message: "The account is not in this budget." };
  const later: SyncSourceTransaction[] = await transport.listTransactionsForSync({ accountId, startDate: nextDay(date) });
  const max = input.maxTransactions ?? DEFAULT_MAX_TRANSACTIONS;
  if (later.length > max) {
    return { ok: false, accountId, date, reason: "too-many-transactions", message: `More than ${max} transactions after ${date}; choose a later date.` };
  }
  // A split parent's amount is the sum of its children; count each movement once.
  const afterMinor = later.filter((t) => !t.isChild).reduce((sum, t) => sum + t.amount, 0);
  return { ok: true, accountId, date, balanceMinor: actualUnitsToMinor(current) - afterMinor, transactionsRead: later.length };
}
