import { runQuery } from "@/lib/api/query";
import type { ConnectionInstance } from "@/store/connection";

/**
 * Which accounts are actually linked to a bank (RD-080 / PR-044).
 *
 * Actual **silently skips** an account with no bank link when a sync is
 * triggered: it is neither synced nor failed, and nothing in the public API's
 * return value says so. Reporting such an account as "synced" would be the one
 * outcome this feature must not produce, so the link is established up front.
 *
 * The AQL `accounts` schema carries everything needed — `account_id`,
 * `account_sync_source`, `last_sync`, `bank_sync_status` — and ActualQL is
 * available in both transports, so this is one read shared by both rather than
 * two per-transport implementations.
 */

export type BankLinkedAccount = {
  id: string;
  name: string;
  /** The provider's own account identifier; absent means no link. */
  externalAccountId: string | null;
  /** e.g. "simpleFin", "goCardless". Absent means no link. */
  syncSource: string | null;
  /** When Actual last pulled for this account, as Actual records it. */
  lastSync: string | null;
  /** Actual's own view of the link's health, when it has one. */
  bankSyncStatus: string | null;
  closed: boolean;
};

type AccountRow = {
  id?: unknown;
  name?: unknown;
  closed?: unknown;
  account_id?: unknown;
  account_sync_source?: unknown;
  last_sync?: unknown;
  bank_sync_status?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function flag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return value === "1" || value === "true";
  return false;
}

/** True when Actual would actually pull for this account. */
export function isBankLinked(account: BankLinkedAccount): boolean {
  return !account.closed && account.externalAccountId !== null;
}

/**
 * Every account with its bank-link metadata, including unlinked and closed
 * ones — the caller decides what to do with them, and a count of "accounts we
 * looked at" is only honest if the ones we skipped are visible.
 */
export async function listAccountsForBankSync(
  connection: ConnectionInstance
): Promise<BankLinkedAccount[]> {
  const response = await runQuery<{ data: AccountRow[] }>(connection, {
    ActualQLquery: {
      table: "accounts",
      select: [
        "id",
        "name",
        "closed",
        "account_id",
        "account_sync_source",
        "last_sync",
        "bank_sync_status",
      ],
    },
  });

  const accounts: BankLinkedAccount[] = [];
  for (const row of response.data ?? []) {
    const id = text(row.id);
    if (!id) continue;

    accounts.push({
      id,
      name: text(row.name) ?? "(unnamed account)",
      externalAccountId: text(row.account_id),
      syncSource: text(row.account_sync_source),
      lastSync: text(row.last_sync),
      bankSyncStatus: text(row.bank_sync_status),
      closed: flag(row.closed),
    });
  }
  return accounts;
}

/**
 * Resolve the accounts a run should trigger, and those it will skip.
 *
 * Asking for one account by id that turns out to be unlinked is not an error —
 * it is a fact worth reporting — so it comes back in `skipped` rather than
 * throwing.
 */
export function selectBankSyncTargets(
  accounts: BankLinkedAccount[],
  accountId?: string
): { targets: BankLinkedAccount[]; skipped: BankLinkedAccount[] } {
  const scope = accountId ? accounts.filter((account) => account.id === accountId) : accounts;
  return {
    targets: scope.filter(isBankLinked),
    skipped: scope.filter((account) => !isBankLinked(account)),
  };
}
