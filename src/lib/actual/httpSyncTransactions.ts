import { apiRequest } from "../api/client";
import { getCategoryGroups } from "../api/categoryGroups";
import { createPayee, getPayees } from "../api/payees";
import { normalizeName } from "@/lib/sync/normalize";
import type { ConnectionInstance } from "@/store/connection";
import type {
  CreateTransactionsForSyncResult,
  ListTransactionsForSyncInput,
  ResolvedSyncPayee,
  SyncCreatedTransaction,
  SyncSourceSplitLine,
  SyncSourceTransaction,
  SyncTargetLookup,
  SyncTargetLookupTransaction,
  SyncTargetTransactionInput,
} from "./transport";

/**
 * Budget File Sync transaction primitives over HTTP API Server mode (RD-060
 * Phase 2). Mirrors the Direct (browser) transport's sync logic but via
 * actual-http-api REST: `imported_id` round-trips through `/transactions/batch`
 * (plain insert - NOT `/import`, which reconciles/runs rules), ids are recovered
 * by reading back the marker, and split lines arrive inline as `subtransactions`
 * (verified against a live server in the Slice 3 spike).
 *
 * actual-http-api returns snake_case and wraps list bodies in `{ data }`.
 */

type RawHttpTransaction = {
  id: string;
  account: string;
  date: string;
  amount: number;
  payee: string | null;
  category: string | null;
  notes: string | null;
  cleared: boolean;
  reconciled: boolean;
  imported_id: string | null;
  is_parent: boolean;
  is_child: boolean;
  parent_id: string | null;
  subtransactions?: RawHttpTransaction[];
};

type NameMaps = { payee: Map<string, string>; category: Map<string, string> };

async function fetchTransactions(
  connection: ConnectionInstance,
  accountId: string,
  startDate?: string
): Promise<RawHttpTransaction[]> {
  const query = startDate ? `?since_date=${encodeURIComponent(startDate)}` : "";
  const res = await apiRequest<{ data?: RawHttpTransaction[] } | RawHttpTransaction[]>(
    connection,
    `/accounts/${accountId}/transactions${query}`
  );
  return Array.isArray(res) ? res : res.data ?? [];
}

async function loadNameMaps(connection: ConnectionInstance): Promise<NameMaps> {
  const payees = await getPayees(connection);
  const { categories } = await getCategoryGroups(connection);
  return {
    payee: new Map(payees.map((p) => [p.id, p.name])),
    category: new Map(categories.map((c) => [c.id, c.name])),
  };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function toSplitLine(raw: RawHttpTransaction, names: NameMaps): SyncSourceSplitLine {
  return {
    id: raw.id ?? null,
    amount: num(raw.amount),
    payeeId: raw.payee ?? null,
    payeeName: raw.payee ? names.payee.get(raw.payee) ?? null : null,
    categoryId: raw.category ?? null,
    categoryName: raw.category ? names.category.get(raw.category) ?? null : null,
    notes: raw.notes ?? null,
  };
}

function toSourceTransaction(raw: RawHttpTransaction, names: NameMaps): SyncSourceTransaction {
  const isParent = raw.is_parent === true;
  return {
    id: raw.id,
    accountId: raw.account,
    date: raw.date,
    amount: num(raw.amount),
    payeeId: raw.payee ?? null,
    payeeName: raw.payee ? names.payee.get(raw.payee) ?? null : null,
    categoryId: raw.category ?? null,
    categoryName: raw.category ? names.category.get(raw.category) ?? null : null,
    notes: raw.notes ?? null,
    cleared: raw.cleared === true,
    reconciled: raw.reconciled === true,
    importedId: raw.imported_id ?? null,
    isParent,
    isChild: raw.is_child === true,
    parentId: raw.parent_id ?? null,
    splitLines: isParent && Array.isArray(raw.subtransactions) ? raw.subtransactions.map((s) => toSplitLine(s, names)) : [],
  };
}

export async function listHttpTransactionsForSync(
  connection: ConnectionInstance,
  input: ListTransactionsForSyncInput
): Promise<SyncSourceTransaction[]> {
  const names = await loadNameMaps(connection);
  const rows = await fetchTransactions(connection, input.accountId, input.startDate);
  return rows
    // Split children arrive inline under their parent; skip top-level leaks.
    .filter((r) => r.is_child !== true)
    .filter((r) => !input.endDate || r.date <= input.endDate)
    .map((r) => toSourceTransaction(r, names));
}

export async function getHttpTargetLookupForSync(
  connection: ConnectionInstance,
  input: ListTransactionsForSyncInput
): Promise<SyncTargetLookup> {
  const payees = await getPayees(connection);
  const payeeNameById = new Map(payees.map((p) => [p.id, p.name]));
  const rows = await fetchTransactions(connection, input.accountId, input.startDate);
  const importedIdIndex = new Map<string, string>();
  const transactions: SyncTargetLookupTransaction[] = [];
  for (const r of rows) {
    if (r.is_child === true) continue;
    if (input.endDate && r.date > input.endDate) continue;
    if (r.imported_id && !importedIdIndex.has(r.imported_id)) importedIdIndex.set(r.imported_id, r.id);
    transactions.push({
      id: r.id,
      date: r.date,
      amount: num(r.amount),
      payeeName: r.payee ? payeeNameById.get(r.payee) ?? null : null,
      categoryId: r.category ?? null,
    });
  }
  return { payees, importedIdIndex, transactions };
}

export async function createOrResolveHttpPayee(
  connection: ConnectionInstance,
  name: string
): Promise<ResolvedSyncPayee> {
  const target = normalizeName(name);
  for (const p of await getPayees(connection)) {
    if (normalizeName(p.name) === target) return { id: p.id, name: p.name, created: false };
  }
  const created = await createPayee(connection, { name });
  return { id: created.id, name, created: true };
}

export async function createHttpTransactionsForSync(
  connection: ConnectionInstance,
  inputs: SyncTargetTransactionInput[]
): Promise<CreateTransactionsForSyncResult> {
  if (inputs.length === 0) return { created: [] };

  // Resolve/create payees once for the whole batch.
  const payeeIdByName = new Map<string, string>();
  for (const p of await getPayees(connection)) payeeIdByName.set(normalizeName(p.name), p.id);
  async function resolvePayeeId(input: SyncTargetTransactionInput): Promise<string | null> {
    if (input.payeeId) return input.payeeId;
    if (!input.payeeName) return null;
    const key = normalizeName(input.payeeName);
    const existing = payeeIdByName.get(key);
    if (existing) return existing;
    const created = await createPayee(connection, { name: input.payeeName });
    payeeIdByName.set(key, created.id);
    return created.id;
  }

  type ApiInsert = { date: string; amount: number; payee: string | null; category: string | null; notes: string | null; cleared: boolean; imported_id: string | null };
  type Entry = { index: number; input: SyncTargetTransactionInput; payload: ApiInsert; payeeId: string | null };
  const byAccount = new Map<string, { entries: Entry[]; minDate: string; maxDate: string }>();
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    const payeeId = await resolvePayeeId(input);
    const payload: ApiInsert = {
      date: input.date,
      amount: input.amount,
      payee: payeeId,
      category: input.categoryId ?? null,
      notes: input.notes ?? null,
      // Actual defaults missing `cleared` to true; be explicit for synced rows.
      cleared: input.cleared ?? false,
      imported_id: input.importedId ?? null,
    };
    const group = byAccount.get(input.accountId);
    if (group) {
      group.entries.push({ index, input, payload, payeeId });
      if (input.date < group.minDate) group.minDate = input.date;
      if (input.date > group.maxDate) group.maxDate = input.date;
    } else {
      byAccount.set(input.accountId, { entries: [{ index, input, payload, payeeId }], minDate: input.date, maxDate: input.date });
    }
  }

  const created: SyncCreatedTransaction[] = new Array(inputs.length);
  for (const [accountId, group] of byAccount) {
    // Plain insert (batch), then one range read to recover ids + fields by marker.
    await apiRequest(connection, `/accounts/${accountId}/transactions/batch`, {
      method: "POST",
      body: { transactions: group.entries.map((e) => e.payload) },
    });
    const rowByMarker = new Map<string, RawHttpTransaction>();
    for (const r of await fetchTransactions(connection, accountId, group.minDate)) {
      if (r.imported_id && !rowByMarker.has(r.imported_id)) rowByMarker.set(r.imported_id, r);
    }
    for (const entry of group.entries) {
      const marker = entry.input.importedId ?? null;
      const row = marker ? rowByMarker.get(marker) : undefined;
      created[entry.index] = {
        requestIndex: entry.index,
        transactionId: row ? row.id : null,
        importedId: marker,
        resolvedPayeeId: entry.payeeId,
        applied: row
          ? { amount: num(row.amount), date: row.date, cleared: row.cleared === true, categoryId: row.category ?? null, payeeId: row.payee ?? null, notes: row.notes ?? null }
          : null,
      };
    }
  }
  return { created };
}
