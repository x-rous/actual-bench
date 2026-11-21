import { getBackupArtifact, getBackupPolicy, type BackupArtifact } from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { openServerTransport, resolveServerConnection } from "@/lib/actual/serverTransport";
import { listSyncCredentialMeta } from "@/lib/credentials/unattendedCredentials";
import { readArtifact, unopenedMessage, withBudgetDatabase } from "./openArtifact";
import { accountRows, transactionsInAccounts, type AccountTransaction } from "./search";

/**
 * Comparing a backup with the budget as it is now (RD-077).
 *
 * "Is this the copy from before the bad import?" is answered by putting the
 * two side by side: which accounts were added or removed since, and for each
 * account its transaction count and balance then and now.
 *
 * The live budget is read on the server through the budget's enrolment, the
 * stored credentials scheduled backups use. A budget that is not enrolled
 * cannot be read here: a Direct budget lives in the browser tab, and Bench
 * holds nothing it could open it with. That case is reported, not guessed.
 *
 * Both sides count the same rows: transactions that are not deleted, split
 * lines rather than their parents (ActualQL's default), starting balances
 * included. Amounts are minor units (cents).
 */

export type AccountSnapshot = {
  name: string;
  offBudget: boolean;
  closed: boolean;
  transactions: number;
  /** Minor units (cents). */
  balanceMinor: number;
};

export type AccountComparison = {
  accountId: string;
  name: string;
  /** `added`: only in the live budget. `removed`: only in the backup. */
  change: "added" | "removed" | "changed" | "same";
  backup: AccountSnapshot | null;
  live: AccountSnapshot | null;
  /** live − backup, minor units; null when the account is on one side only. */
  balanceDeltaMinor: number | null;
  transactionDelta: number | null;
  /** For a changed account: the transactions behind the difference. */
  details: TransactionDifferences | null;
};

/** The rows that make a changed account differ. Each list is capped at `DETAIL_LIMIT`; the counts are not. */
export type TransactionDifferences = {
  onlyInCopy: AccountTransaction[];
  onlyNow: AccountTransaction[];
  edited: { before: AccountTransaction; after: AccountTransaction }[];
  counts: { onlyInCopy: number; onlyNow: number; edited: number };
};

/** At most this many changed accounts get their rows listed, and this many rows per list. */
export const DETAIL_ACCOUNTS = 10;
export const DETAIL_LIMIT = 50;

/** Reads the live budget: its accounts, and the transactions of a few of them. */
export type LiveBudgetReader = {
  accounts(): Promise<Map<string, AccountSnapshot>>;
  transactions(accountIds: string[]): Promise<AccountTransaction[]>;
};

export type BackupComparison =
  | {
      opened: true;
      takenAt: string;
      budgetName: string | null;
      accounts: AccountComparison[];
      totals: {
        backup: { accounts: number; transactions: number };
        live: { accounts: number; transactions: number };
      };
    }
  | { opened: false; message: string };

/** The enrolment that reads this backup's budget, or null when there is none. */
export function liveConnectionFor(db: SqliteDatabase, artifact: BackupArtifact): string | null {
  if (!artifact.sourceBudgetId) return null;
  const enrolled = listSyncCredentialMeta(db).filter((meta) => meta.budgetSyncId === artifact.sourceBudgetId);
  if (enrolled.length === 0) return null;
  // The rule's own connection when it still reads this budget; any other
  // enrolment of the same budget otherwise.
  const ruleFingerprint = artifact.policyId
    ? getBackupPolicy(db, artifact.policyId)?.sourceRef.data.connectionFingerprint
    : undefined;
  return (enrolled.find((meta) => meta.connectionFingerprint === ruleFingerprint) ?? enrolled[0]).connectionFingerprint;
}

type Row = Record<string, unknown>;

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

/** The live budget's accounts, with their counts and balances, through ActualQL. */
export async function readLiveAccounts(
  runQuery: <T>(body: object) => Promise<T>
): Promise<Map<string, AccountSnapshot>> {
  const accounts = await runQuery<{ data: Row[] }>({
    ActualQLquery: { table: "accounts", select: ["id", "name", "offbudget", "closed"] },
  });
  const totals = await runQuery<{ data: Row[] }>({
    ActualQLquery: {
      table: "transactions",
      groupBy: ["account"],
      select: ["account", { balance: { $sum: "$amount" } }, { count: { $count: "$id" } }],
    },
  });
  const byAccount = new Map((totals.data ?? []).map((row) => [String(row.account), row]));
  const live = new Map<string, AccountSnapshot>();
  for (const row of accounts.data ?? []) {
    if (typeof row.id !== "string") continue;
    const total = byAccount.get(row.id);
    live.set(row.id, {
      name: typeof row.name === "string" ? row.name : "(unnamed account)",
      offBudget: flag(row.offbudget),
      closed: flag(row.closed),
      transactions: Number(total?.count ?? 0),
      balanceMinor: Number(total?.balance ?? 0),
    });
  }
  return live;
}

/** The live transactions of some accounts, counted by ActualQL's default rules (the copy's side uses the same). */
export async function readLiveTransactions(
  runQuery: <T>(body: object) => Promise<T>,
  accountIds: string[]
): Promise<AccountTransaction[]> {
  if (accountIds.length === 0) return [];
  const response = await runQuery<{ data: Row[] }>({
    ActualQLquery: {
      table: "transactions",
      filter: { account: { $oneof: accountIds } },
      select: ["id", "account", "date", "amount", "notes", "payee.name", "category.name"],
    },
  });
  return (response.data ?? [])
    .filter((row) => typeof row.id === "string")
    .map((row) => ({
      id: row.id as string,
      accountId: String(row.account),
      date: typeof row.date === "string" ? row.date : null,
      payee: typeof row["payee.name"] === "string" && row["payee.name"] ? (row["payee.name"] as string) : null,
      category: typeof row["category.name"] === "string" ? (row["category.name"] as string) : null,
      amountMinor: Number(row.amount ?? 0),
      notes: typeof row.notes === "string" && row.notes ? row.notes : null,
    }));
}

/** Match the two sides' rows of one account by id. */
export function differences(copy: AccountTransaction[], now: AccountTransaction[]): TransactionDifferences {
  const live = new Map(now.map((row) => [row.id, row]));
  const then = new Map(copy.map((row) => [row.id, row]));
  const onlyInCopy = copy.filter((row) => !live.has(row.id));
  const onlyNow = now.filter((row) => !then.has(row.id));
  const edited = copy
    .filter((row) => {
      const after = live.get(row.id);
      return after !== undefined && (after.amountMinor !== row.amountMinor || after.date !== row.date);
    })
    .map((before) => ({ before, after: live.get(before.id) as AccountTransaction }));
  const byDate = (a: AccountTransaction, b: AccountTransaction) => (b.date ?? "").localeCompare(a.date ?? "");
  return {
    onlyInCopy: onlyInCopy.sort(byDate).slice(0, DETAIL_LIMIT),
    onlyNow: onlyNow.sort(byDate).slice(0, DETAIL_LIMIT),
    edited: edited.sort((a, b) => byDate(a.before, b.before)).slice(0, DETAIL_LIMIT),
    counts: { onlyInCopy: onlyInCopy.length, onlyNow: onlyNow.length, edited: edited.length },
  };
}

const CHANGE_ORDER: Record<AccountComparison["change"], number> = { removed: 0, added: 1, changed: 2, same: 3 };

/** Put the two sides together, by account id. Changes first, then by name. */
export function compareAccounts(
  backup: Map<string, AccountSnapshot>,
  live: Map<string, AccountSnapshot>
): AccountComparison[] {
  const ids = new Set([...backup.keys(), ...live.keys()]);
  const rows: AccountComparison[] = [];
  for (const accountId of ids) {
    const then = backup.get(accountId) ?? null;
    const now = live.get(accountId) ?? null;
    const change: AccountComparison["change"] = !then
      ? "added"
      : !now
        ? "removed"
        : then.balanceMinor !== now.balanceMinor ||
            then.transactions !== now.transactions ||
            then.closed !== now.closed ||
            then.name !== now.name ||
            then.offBudget !== now.offBudget
          ? "changed"
          : "same";
    rows.push({
      accountId,
      name: now?.name ?? then?.name ?? accountId,
      change,
      backup: then,
      live: now,
      balanceDeltaMinor: then && now ? now.balanceMinor - then.balanceMinor : null,
      transactionDelta: then && now ? now.transactions - then.transactions : null,
      details: null,
    });
  }
  return rows.sort(
    (a, b) => CHANGE_ORDER[a.change] - CHANGE_ORDER[b.change] || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

function sum(values: Iterable<AccountSnapshot>) {
  let accounts = 0;
  let transactions = 0;
  for (const value of values) {
    accounts += 1;
    transactions += value.transactions;
  }
  return { accounts, transactions };
}

export async function compareArtifact(
  db: SqliteDatabase,
  artifactId: string,
  options: {
    passphrase?: string;
    signal?: AbortSignal;
    /** Replaces the read through the budget's enrolment; for tests. */
    live?: LiveBudgetReader;
  } = {}
): Promise<BackupComparison> {
  // Decided before anything is downloaded: a settings copy cannot be
  // compared, and a budget Bench holds no credentials for cannot be read live,
  // so fetching and decrypting the copy first would be wasted work.
  const artifact = getBackupArtifact(db, artifactId);
  if (!artifact) throw new Error("That backup is not in the inventory.");
  if (artifact.kind !== "budget") {
    return { opened: false, message: "This is a copy of Actual Bench's own data; only a budget backup can be compared." };
  }

  let reader = options.live;
  if (!reader) {
    const fingerprint = liveConnectionFor(db, artifact);
    if (!fingerprint) {
      return {
        opened: false,
        message:
          "Bench has no stored credentials for this budget, so it cannot read it as it is now. Enrol the budget for unattended use to compare with it.",
      };
    }
    let transport: ReturnType<typeof openServerTransport> | null = null;
    const open = () => {
      if (transport) return transport;
      const connection = resolveServerConnection(db, fingerprint);
      if (!connection) throw new Error("The budget's enrolment is no longer stored.");
      transport = openServerTransport(connection);
      return transport;
    };
    reader = {
      accounts: () => readLiveAccounts((body) => open().runQuery(body)),
      transactions: (ids) => readLiveTransactions((body) => open().runQuery(body), ids),
    };
  }

  const read = await readArtifact(db, artifactId, options);
  if (read.status !== "opened") return { opened: false, message: unopenedMessage(read) };
  options.signal?.throwIfAborted();
  const live = await reader.accounts();
  options.signal?.throwIfAborted();

  // One pass over the copy: its accounts, then the rows of the accounts
  // that differ from the live budget, so each change can be explained.
  const { backup, accounts, copyRows } = withBudgetDatabase(read.plaintext, (database) => {
    const map = new Map<string, AccountSnapshot>();
    for (const row of accountRows(database).rows) {
      const { id, ...snapshot } = row;
      map.set(id, snapshot);
    }
    const compared = compareAccounts(map, live);
    const changed = compared
      .filter((row) => row.change === "changed")
      .slice(0, DETAIL_ACCOUNTS)
      .map((row) => row.accountId);
    return { backup: map, accounts: compared, copyRows: transactionsInAccounts(database, changed) };
  });

  const detailIds = accounts
    .filter((row) => row.change === "changed")
    .slice(0, DETAIL_ACCOUNTS)
    .map((row) => row.accountId);
  const liveRows = detailIds.length > 0 ? await reader.transactions(detailIds) : [];
  for (const row of accounts) {
    if (!detailIds.includes(row.accountId)) continue;
    row.details = differences(
      copyRows.filter((entry) => entry.accountId === row.accountId),
      liveRows.filter((entry) => entry.accountId === row.accountId)
    );
  }

  return {
    opened: true,
    takenAt: artifact.createdAt,
    budgetName: artifact.sourceBudgetName,
    accounts,
    totals: { backup: sum(backup.values()), live: sum(live.values()) },
  };
}
