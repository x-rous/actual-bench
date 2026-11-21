import { getBackupArtifact } from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { readArtifact, unopenedMessage, withBudgetDatabase, type BudgetDatabase } from "./openArtifact";

/**
 * Finding something inside a backup (RD-077).
 *
 * The usual reason to open a backup is one thing that went missing - a
 * transaction, a payee, a category - not the whole budget. This searches a
 * copy's own database, read-only, and shows rows as they were in that copy, so
 * "is it in this backup?" is answered without restoring anything.
 *
 * Rows Actual had already deleted when the copy was taken (`tombstone = 1`)
 * are left out: they were not in the budget then either. Split parents are
 * left out too; their lines are what carry the category, as in Actual's own
 * transaction list. Payee and category ids go through Actual's mapping tables,
 * so a transaction whose payee was merged shows the payee it was merged into.
 *
 * Amounts are Actual's stored integers: minor units (cents).
 */

export type BackupSearchKind = "transactions" | "payees" | "categories" | "accounts";

export const BACKUP_SEARCH_KINDS: BackupSearchKind[] = ["transactions", "payees", "categories", "accounts"];
export const BACKUP_SEARCH_PAGE_SIZE = 100;

export type BackupSearchInput = {
  kind: BackupSearchKind;
  /** Matched case-insensitively against names and notes; a number also matches an amount. */
  text: string;
  /** ISO `yyyy-MM-dd`, inclusive. Transactions only. */
  from?: string | null;
  to?: string | null;
  /** Zero-based. */
  page?: number;
};

export type BackupTransactionRow = {
  id: string;
  /** ISO `yyyy-MM-dd`, or null when the row has no date. */
  date: string | null;
  account: string | null;
  payee: string | null;
  category: string | null;
  /** Minor units (cents), signed as Actual stores it. */
  amountMinor: number;
  notes: string | null;
  cleared: boolean | null;
  /** A line of a split transaction. */
  split: boolean;
};

export type BackupPayeeRow = { id: string; name: string; transactions: number };
export type BackupCategoryRow = { id: string; name: string; group: string | null; hidden: boolean; transactions: number };
export type BackupAccountRow = {
  id: string;
  name: string;
  offBudget: boolean;
  closed: boolean;
  transactions: number;
  /** Minor units (cents): the sum of the account's transactions in this copy. */
  balanceMinor: number;
};

export type BackupSearchRows =
  | { kind: "transactions"; rows: BackupTransactionRow[] }
  | { kind: "payees"; rows: BackupPayeeRow[] }
  | { kind: "categories"; rows: BackupCategoryRow[] }
  | { kind: "accounts"; rows: BackupAccountRow[] };

export type BackupSearchResult =
  | ({ opened: true; total: number; page: number; pageSize: number } & BackupSearchRows)
  | { opened: false; message: string };

// ── the copy's schema, which varies with the Actual version that wrote it ──

type Schema = {
  columns(table: string): Set<string>;
  hasTable(table: string): boolean;
};

function schemaOf(database: BudgetDatabase): Schema {
  const cache = new Map<string, Set<string>>();
  const columns = (table: string) => {
    let found = cache.get(table);
    if (!found) {
      const rows = database.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as { name: string }[];
      found = new Set(rows.map((row) => row.name));
      cache.set(table, found);
    }
    return found;
  };
  return { columns, hasTable: (table) => columns(table).size > 0 };
}

/** `alias.column`, or `fallback` when this copy's table has no such column. */
function column(schema: Schema, table: string, alias: string, name: string, fallback = "NULL"): string {
  return schema.columns(table).has(name) ? `${alias}."${name}"` : fallback;
}

function alive(schema: Schema, table: string, alias: string): string {
  return schema.columns(table).has("tombstone") ? `COALESCE(${alias}.tombstone, 0) = 0` : "1 = 1";
}

/** `LIKE` with the user's text taken literally. */
function likePattern(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/** "12.50", "-12.5", "1,234.00" → 1250 / 123400 (minor units, sign ignored); otherwise null. */
export function amountFromText(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Math.abs(Number(cleaned)) * 100);
}

function isoToActual(iso: string | null | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return Number(iso.replace(/-/g, ""));
}

function actualToIso(value: unknown): string | null {
  const text = typeof value === "number" || typeof value === "string" ? String(value) : "";
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : null;
}

/**
 * The joins that turn a transaction's ids into what Actual shows: its
 * account, its payee (through `payee_mapping`, so a merged payee resolves to
 * the one it became, and a transfer shows the other account), its category
 * (through `category_mapping`).
 */
function transactionFrom(schema: Schema): { from: string; payee: string; category: string; account: string } {
  // Each join only where this copy has what it needs: a copy written by an
  // older or trimmed-down Actual may lack a mapping table or a column.
  const description = column(schema, "transactions", "t", "description");
  const categoryRef = column(schema, "transactions", "t", "category");
  const hasPayees = schema.hasTable("payees");
  const hasCategories = schema.hasTable("categories");
  const payeeMapping = hasPayees && schema.hasTable("payee_mapping") && description !== "NULL";
  const categoryMapping = hasCategories && schema.hasTable("category_mapping") && categoryRef !== "NULL";
  const payeeId = payeeMapping ? `COALESCE(pm.targetId, ${description})` : description;
  const categoryId = categoryMapping ? `COALESCE(cm.transferId, ${categoryRef})` : categoryRef;
  const transferAccount = hasPayees ? column(schema, "payees", "p", "transfer_acct") : "NULL";
  const from = [
    "transactions t",
    "LEFT JOIN accounts a ON a.id = t.acct",
    payeeMapping ? `LEFT JOIN payee_mapping pm ON pm.id = ${description}` : "",
    hasPayees ? `LEFT JOIN payees p ON p.id = ${payeeId}` : "",
    `LEFT JOIN accounts ta ON ta.id = ${transferAccount}`,
    categoryMapping ? `LEFT JOIN category_mapping cm ON cm.id = ${categoryRef}` : "",
    hasCategories ? `LEFT JOIN categories c ON c.id = ${categoryId}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    from,
    // A transfer's payee has no name of its own; Actual shows the account.
    payee: hasPayees ? `CASE WHEN ta.id IS NOT NULL THEN 'Transfer: ' || ta.name ELSE NULLIF(p.name, '') END` : "NULL",
    category: hasCategories ? "c.name" : "NULL",
    account: "a.name",
  };
}

/**
 * What makes a transaction one the copy's user could see: the rules of
 * Actual's own `v_transactions_internal_alive` view, which ActualQL reads, so
 * a copy and the live budget count the same rows. Not deleted; has a date
 * and an account; and a split line only while its parent exists and is not
 * deleted - deleting a split can leave its lines behind, and Actual no
 * longer counts them. Split parents are left out, as ActualQL's default
 * `inline` splits do.
 */
function liveTransaction(schema: Schema): string[] {
  const columns = schema.columns("transactions");
  const conditions = [
    alive(schema, "transactions", "t"),
    columns.has("date") ? "t.date IS NOT NULL" : "1 = 1",
    "t.acct IS NOT NULL",
    columns.has("isParent") ? "COALESCE(t.isParent, 0) = 0" : "1 = 1",
    // A transaction in a deleted account was gone from the budget too.
    `(a.id IS NULL OR ${alive(schema, "accounts", "a")})`,
  ];
  if (columns.has("isChild") && columns.has("parent_id")) {
    const parentAlive = columns.has("tombstone") ? " AND tp.tombstone = 0" : "";
    conditions.push(
      `(COALESCE(t.isChild, 0) = 0 OR EXISTS (SELECT 1 FROM transactions tp WHERE tp.id = t.parent_id${parentAlive}))`
    );
  }
  return conditions;
}

type Page = { limit: number; offset: number };

function searchTransactions(database: BudgetDatabase, schema: Schema, input: BackupSearchInput, page: Page) {
  const { from, payee, category, account } = transactionFrom(schema);
  const where = liveTransaction(schema);
  const params: (string | number)[] = [];

  const text = input.text.trim();
  if (text) {
    const like = likePattern(text);
    const notes = column(schema, "transactions", "t", "notes", "''");
    const imported = column(schema, "transactions", "t", "imported_description", "''");
    const fields = [payee, category, account, notes, imported].map((field) => `LOWER(COALESCE(${field}, '')) LIKE ? ESCAPE '\\'`);
    params.push(...fields.map(() => like));
    const amount = amountFromText(text);
    if (amount !== null) {
      fields.push("ABS(t.amount) = ?");
      params.push(amount);
    }
    where.push(`(${fields.join(" OR ")})`);
  }
  const fromDate = isoToActual(input.from);
  if (fromDate !== null) {
    where.push("t.date >= ?");
    params.push(fromDate);
  }
  const toDate = isoToActual(input.to);
  if (toDate !== null) {
    where.push("t.date <= ?");
    params.push(toDate);
  }

  const clause = `FROM ${from}\nWHERE ${where.join(" AND ")}`;
  const total = (database.prepare(`SELECT COUNT(*) AS n ${clause}`).get(...params) as { n: number }).n;
  const order = schema.columns("transactions").has("sort_order") ? "t.date DESC, t.sort_order DESC, t.id" : "t.date DESC, t.id";
  const rows = database
    .prepare(
      `SELECT t.id, t.date, t.amount, ${column(schema, "transactions", "t", "notes")} AS notes,
              ${column(schema, "transactions", "t", "cleared")} AS cleared,
              ${column(schema, "transactions", "t", "isChild", "0")} AS is_child,
              ${account} AS account, ${payee} AS payee, ${category} AS category
       ${clause}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`
    )
    .all(...params, page.limit, page.offset) as {
    id: string;
    date: unknown;
    amount: number | null;
    notes: string | null;
    cleared: number | null;
    is_child: number | null;
    account: string | null;
    payee: string | null;
    category: string | null;
  }[];

  return {
    total,
    rows: rows.map<BackupTransactionRow>((row) => ({
      id: row.id,
      date: actualToIso(row.date),
      account: row.account,
      payee: row.payee,
      category: row.category,
      amountMinor: Number(row.amount ?? 0),
      notes: row.notes || null,
      cleared: row.cleared === null ? null : Number(row.cleared) === 1,
      split: Number(row.is_child ?? 0) === 1,
    })),
  };
}

/** Live, non-parent transactions per resolved id of `target` (payee, category or account). */
function transactionCounts(schema: Schema, target: "payee" | "category" | "account"): string {
  const payeeId = schema.hasTable("payee_mapping") ? "COALESCE(pm.targetId, t.description)" : "t.description";
  const categoryId = schema.hasTable("category_mapping") ? "COALESCE(cm.transferId, t.category)" : "t.category";
  const key = target === "payee" ? payeeId : target === "category" ? categoryId : "t.acct";
  const joins = [
    "LEFT JOIN accounts a ON a.id = t.acct",
    target === "payee" && schema.hasTable("payee_mapping") ? "LEFT JOIN payee_mapping pm ON pm.id = t.description" : "",
    target === "category" && schema.hasTable("category_mapping") ? "LEFT JOIN category_mapping cm ON cm.id = t.category" : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `SELECT ${key} AS ref, COUNT(*) AS n, COALESCE(SUM(t.amount), 0) AS total
            FROM transactions t ${joins}
           WHERE ${liveTransaction(schema).join(" AND ")}
           GROUP BY ${key}`;
}

function nameFilter(input: BackupSearchInput, field: string, params: (string | number)[]): string {
  const text = input.text.trim();
  if (!text) return "";
  params.push(likePattern(text));
  return ` AND LOWER(COALESCE(${field}, '')) LIKE ? ESCAPE '\\'`;
}

function searchPayees(database: BudgetDatabase, schema: Schema, input: BackupSearchInput, page: Page) {
  const params: (string | number)[] = [];
  // Transfer payees stand for accounts, and are listed under accounts.
  const notTransfer = schema.columns("payees").has("transfer_acct") ? " AND p.transfer_acct IS NULL" : "";
  const clause = `FROM payees p LEFT JOIN (${transactionCounts(schema, "payee")}) n ON n.ref = p.id
                 WHERE ${alive(schema, "payees", "p")}${notTransfer} AND COALESCE(p.name, '') <> ''${nameFilter(input, "p.name", params)}`;
  const total = (database.prepare(`SELECT COUNT(*) AS n ${clause}`).get(...params) as { n: number }).n;
  const rows = database
    .prepare(`SELECT p.id, p.name, COALESCE(n.n, 0) AS transactions ${clause} ORDER BY LOWER(p.name), p.id LIMIT ? OFFSET ?`)
    .all(...params, page.limit, page.offset) as BackupPayeeRow[];
  return { total, rows: rows.map((row) => ({ ...row, transactions: Number(row.transactions) })) };
}

function searchCategories(database: BudgetDatabase, schema: Schema, input: BackupSearchInput, page: Page) {
  const params: (string | number)[] = [];
  const group =
    schema.hasTable("category_groups") && schema.columns("categories").has("cat_group")
      ? { join: "LEFT JOIN category_groups g ON g.id = c.cat_group", name: "g.name" }
      : { join: "", name: "NULL" };
  const clause = `FROM categories c ${group.join} LEFT JOIN (${transactionCounts(schema, "category")}) n ON n.ref = c.id
                 WHERE ${alive(schema, "categories", "c")}${nameFilter(input, "c.name", params)}`;
  const total = (database.prepare(`SELECT COUNT(*) AS n ${clause}`).get(...params) as { n: number }).n;
  const rows = database
    .prepare(
      `SELECT c.id, c.name, ${group.name} AS grp, ${column(schema, "categories", "c", "hidden", "0")} AS hidden,
              COALESCE(n.n, 0) AS transactions
       ${clause}
       ORDER BY LOWER(COALESCE(${group.name}, '')), LOWER(c.name), c.id LIMIT ? OFFSET ?`
    )
    .all(...params, page.limit, page.offset) as { id: string; name: string; grp: string | null; hidden: number; transactions: number }[];
  return {
    total,
    rows: rows.map<BackupCategoryRow>((row) => ({
      id: row.id,
      name: row.name,
      group: row.grp,
      hidden: Number(row.hidden) === 1,
      transactions: Number(row.transactions),
    })),
  };
}

/** Every account in the copy with its transaction count and balance. Also what compare reads. */
export function accountRows(database: BudgetDatabase, input: Pick<BackupSearchInput, "text"> = { text: "" }, page?: Page) {
  const schema = schemaOf(database);
  const params: (string | number)[] = [];
  const clause = `FROM accounts a LEFT JOIN (${transactionCounts(schema, "account")}) n ON n.ref = a.id
                 WHERE ${alive(schema, "accounts", "a")}${nameFilter({ kind: "accounts", ...input }, "a.name", params)}`;
  const total = (database.prepare(`SELECT COUNT(*) AS n ${clause}`).get(...params) as { n: number }).n;
  const order = schema.columns("accounts").has("sort_order") ? "a.sort_order, LOWER(a.name), a.id" : "LOWER(a.name), a.id";
  const rows = database
    .prepare(
      `SELECT a.id, a.name, ${column(schema, "accounts", "a", "offbudget", "0")} AS offbudget,
              ${column(schema, "accounts", "a", "closed", "0")} AS closed,
              COALESCE(n.n, 0) AS transactions, COALESCE(n.total, 0) AS balance
       ${clause}
       ORDER BY ${order}${page ? " LIMIT ? OFFSET ?" : ""}`
    )
    .all(...params, ...(page ? [page.limit, page.offset] : [])) as {
    id: string;
    name: string;
    offbudget: number;
    closed: number;
    transactions: number;
    balance: number;
  }[];
  return {
    total,
    rows: rows.map<BackupAccountRow>((row) => ({
      id: row.id,
      name: row.name,
      offBudget: Number(row.offbudget) === 1,
      closed: Number(row.closed) === 1,
      transactions: Number(row.transactions),
      balanceMinor: Number(row.balance),
    })),
  };
}

/** One transaction of an account, for comparing a copy with the live budget. */
export type AccountTransaction = {
  id: string;
  accountId: string;
  date: string | null;
  payee: string | null;
  category: string | null;
  /** Minor units (cents). */
  amountMinor: number;
  notes: string | null;
};

/**
 * Every transaction the copy counts in these accounts, by the same rules the
 * counts use. Compare lists the ones that differ from the live budget, so a
 * changed balance comes with the rows that changed it.
 */
export function transactionsInAccounts(database: BudgetDatabase, accountIds: string[]): AccountTransaction[] {
  if (accountIds.length === 0) return [];
  const schema = schemaOf(database);
  const { from, payee, category } = transactionFrom(schema);
  const rows = database
    .prepare(
      `SELECT t.id, t.acct AS account_id, t.date, t.amount, ${column(schema, "transactions", "t", "notes")} AS notes,
              ${payee} AS payee, ${category} AS category
       FROM ${from}
       WHERE ${liveTransaction(schema).join(" AND ")} AND t.acct IN (${accountIds.map(() => "?").join(", ")})`
    )
    .all(...accountIds) as {
    id: string;
    account_id: string;
    date: unknown;
    amount: number | null;
    notes: string | null;
    payee: string | null;
    category: string | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    date: actualToIso(row.date),
    payee: row.payee,
    category: row.category,
    amountMinor: Number(row.amount ?? 0),
    notes: row.notes || null,
  }));
}

/** Search an open budget database. Exported for tests; `searchArtifact` is the entry point. */
export function searchBudgetDatabase(database: BudgetDatabase, input: BackupSearchInput): BackupSearchResult {
  const schema = schemaOf(database);
  if (!schema.hasTable("transactions") || !schema.hasTable("accounts")) {
    return { opened: false, message: "This copy does not have Actual's tables, so there is nothing to search." };
  }
  const pageIndex = Math.max(0, Math.floor(input.page ?? 0));
  const page = { limit: BACKUP_SEARCH_PAGE_SIZE, offset: pageIndex * BACKUP_SEARCH_PAGE_SIZE };
  const meta = { opened: true as const, page: pageIndex, pageSize: BACKUP_SEARCH_PAGE_SIZE };

  switch (input.kind) {
    case "transactions":
      return { ...meta, kind: "transactions", ...searchTransactions(database, schema, input, page) };
    case "payees":
      if (!schema.hasTable("payees")) return { ...meta, kind: "payees", total: 0, rows: [] };
      return { ...meta, kind: "payees", ...searchPayees(database, schema, input, page) };
    case "categories":
      if (!schema.hasTable("categories")) return { ...meta, kind: "categories", total: 0, rows: [] };
      return { ...meta, kind: "categories", ...searchCategories(database, schema, input, page) };
    case "accounts":
      return { ...meta, kind: "accounts", ...accountRows(database, input, page) };
  }
}

/**
 * Search one stored backup of a budget. Reads it the way "Look inside" does,
 * but records nothing: a search is not a verification.
 */
export async function searchArtifact(
  db: SqliteDatabase,
  artifactId: string,
  input: BackupSearchInput,
  options: { passphrase?: string; signal?: AbortSignal } = {}
): Promise<BackupSearchResult> {
  // Refused before the copy is fetched and decrypted, not after.
  if (getBackupArtifact(db, artifactId)?.kind === "app-db") {
    return { opened: false, message: "This is a copy of Actual Bench's own data; only a budget backup can be searched." };
  }
  const read = await readArtifact(db, artifactId, options);
  if (read.status !== "opened") return { opened: false, message: unopenedMessage(read) };
  options.signal?.throwIfAborted();
  return withBudgetDatabase(read.plaintext, (database) => searchBudgetDatabase(database, input));
}
