import type { ActualApi, ActualQueryBuilder, ApiTransaction } from "./runtime/types";
import type { RawTxn } from "./transactionStructure";
import { runtimeTiming } from "./runtime/diagnostics";

function transactionRows(response: unknown): ApiTransaction[] {
  const rows = response && typeof response === "object" && "data" in response ? response.data : undefined;
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object"
    || typeof row.id !== "string" || typeof row.account !== "string" || typeof row.date !== "string"
    || typeof row.amount !== "number" || typeof row.is_child !== "boolean"
    || typeof row.is_parent !== "boolean")) {
    throw new Error("Actual returned an incomplete structural transaction query.");
  }
  return rows as ApiTransaction[];
}

/** Match Actual's grouped-query ordering without making SQLite sort its expansion. */
function actualTransactionOrder(a: RawTxn, b: RawTxn): number {
  if (a.date !== b.date) return a.date! > b.date! ? -1 : 1;
  const startingBalance = Number(a.starting_balance_flag === true) - Number(b.starting_balance_flag === true);
  if (startingBalance) return startingBalance;
  const aSort = typeof a.sort_order === "number" ? a.sort_order : null;
  const bSort = typeof b.sort_order === "number" ? b.sort_order : null;
  if (aSort !== bSort) {
    if (aSort === null) return 1;
    if (bSort === null) return -1;
    return bSort - aSort;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Read complete groups through public ActualQL, without its grouped executor's
 * unscoped IFNULL(parent_id, id) expansion and transaction-display sorting.
 * Children are selected globally by parent identity: date/account filters on
 * children would silently omit edited lines. Even ordinary rows can have lines
 * during settlement, so query children for every selected top-level row.
 * Each call is fresh; no evidence is retained between reads or writes.
 */
export async function readStructuralAccounts(
  api: ActualApi,
  accountIds: readonly string[],
  sinceDate: string,
  untilDate?: string,
): Promise<Map<string, RawTxn[]>> {
  const accounts = new Map<string, RawTxn[]>([...new Set(accountIds)].map((id) => [id, []]));
  if (!accounts.size) return accounts;
  const runner = api.aqlQuery?.bind(api) ?? api.runQuery?.bind(api);
  if (!api.q || !runner) {
    // Older API builds retain their original, complete grouped reader.
    for (const accountId of accounts.keys()) {
      accounts.set(accountId, (await api.getTransactions(accountId, sinceDate, untilDate ?? ""))
        .filter((row) => row && typeof row === "object" && typeof row.id === "string" && row.is_child !== true) as RawTxn[]);
    }
    return accounts;
  }
  const flatQuery = (filter: object): ActualQueryBuilder => api.q!("transactions")
    .filter(filter).select("*").options({ splits: "all" }).orderBy("id");
  const queryRows = async (filter: object, phase: "parents" | "children") => {
    const timing = runtimeTiming(`Direct structural query (${phase})`);
    try { return transactionRows(await runner(flatQuery(filter))); }
    finally { timing.end(); }
  };
  const parents = await queryRows({ $and: [
    { account: { $oneof: [...accounts.keys()] } },
    { is_child: false },
    ...(sinceDate ? [{ date: { $gte: sinceDate } }] : []),
    ...(untilDate ? [{ date: { $lte: untilDate } }] : []),
  ] }, "parents");
  if (!parents.length) return accounts;
  const byId = new Map<string, RawTxn>();
  for (const row of parents) {
    if (row.is_child || !accounts.has(row.account) || byId.has(row.id)
      || (sinceDate && row.date < sinceDate) || (untilDate && row.date > untilDate)) {
      throw new Error("Actual returned an inconsistent structural transaction query.");
    }
    const parent: RawTxn = { ...row, subtransactions: [] };
    byId.set(row.id, parent);
    accounts.get(row.account)!.push(parent);
  }
  const children = await queryRows({ parent_id: { $oneof: [...byId.keys()] } }, "children");
  const childIds = new Set<string>();
  for (const child of children) {
    const parent = child.parent_id ? byId.get(child.parent_id) : undefined;
    if (!child.is_child || !parent || childIds.has(child.id) || byId.has(child.id)) {
      throw new Error("Actual returned an inconsistent structural split query.");
    }
    childIds.add(child.id);
    parent.subtransactions!.push(child as RawTxn);
  }
  // Child positions are part of the existing split-result contract. Random IDs
  // must not reorder principal/interest/fee lines consumed by exact verification.
  for (const rows of accounts.values()) {
    rows.sort(actualTransactionOrder);
    for (const parent of rows) parent.subtransactions!.sort(actualTransactionOrder);
  }
  return accounts;
}
