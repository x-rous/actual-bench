import { runQuery } from "@/lib/api/query";
import type { ConnectionInstance } from "@/store/connection";
import type { AssetEntry } from "./assetReview";
import type { PayeeRow } from "./breakdowns";
import type { OtherSide, TransferRow } from "./inTransit";
import type { DatedAmount, LoanCostRow, MovementRow, ReclassifiedRow } from "./measures";

/**
 * The ActualQL reads behind Financial Insights. Each is one grouped query that returns the same rows in Direct and
 * HTTP, never past today, and never a name path on the transfer account (those fail): names are mapped from the
 * account and category lists. Starting balances are separated in the query itself, by their payee, so they can never
 * be counted as income or as a value change.
 */

type Response<T> = { data: T[] };

const STARTING = "Starting Balance";
const notStarting = { $or: [{ payee: null }, { "payee.name": { $ne: STARTING } }] };
const upToToday = (today: string) => ({ date: { $lte: today } });

type MovementResult = { month: string; account: string; category: string | null; "payee.transfer_acct": string | null; amt: number; n: number };

/** Everything but starting balances: by month, account, category and the account on the other side of a transfer. */
export async function readMovement(connection: ConnectionInstance, today: string): Promise<MovementRow[]> {
  const response = await runQuery<Response<MovementResult>>(connection, {
    ActualQLquery: {
      table: "transactions",
      filter: { $and: [upToToday(today), notStarting] },
      groupBy: [{ $month: "$date" }, "account", "category", "payee.transfer_acct"],
      select: [{ month: { $month: "$date" } }, "account", "category", "payee.transfer_acct", { amt: { $sum: "$amount" } }, { n: { $count: "$id" } }],
    },
  });
  return response.data.map((r) => ({
    month: r.month, accountId: r.account, categoryId: r.category, transferAccountId: r["payee.transfer_acct"], amountMinor: r.amt, count: r.n,
  }));
}

type PerAccountMonth = { month: string; account: string; amt: number };

export async function readStartingBalances(connection: ConnectionInstance, today: string): Promise<DatedAmount[]> {
  const response = await runQuery<Response<PerAccountMonth>>(connection, {
    ActualQLquery: {
      table: "transactions",
      filter: { $and: [upToToday(today), { "payee.name": STARTING }] },
      groupBy: [{ $month: "$date" }, "account"],
      select: [{ month: { $month: "$date" } }, "account", { amt: { $sum: "$amount" } }],
    },
  });
  return response.data.map((r) => ({ month: r.month, accountId: r.account, amountMinor: r.amt }));
}

/** The positive part of the transfer rows (money received), by month, account and counterpart. */
export async function readTransfersIn(connection: ConnectionInstance, today: string): Promise<(DatedAmount & { transferAccountId: string })[]> {
  const response = await runQuery<Response<PerAccountMonth & { "payee.transfer_acct": string }>>(connection, {
    ActualQLquery: {
      table: "transactions",
      filter: { $and: [upToToday(today), notStarting, { "payee.transfer_acct": { $ne: null } }, { amount: { $gt: 0 } }] },
      groupBy: [{ $month: "$date" }, "account", "payee.transfer_acct"],
      select: [{ month: { $month: "$date" } }, "account", "payee.transfer_acct", { amt: { $sum: "$amount" } }],
    },
  });
  return response.data.map((r) => ({ month: r.month, accountId: r.account, transferAccountId: r["payee.transfer_acct"], amountMinor: r.amt }));
}

/** The positive part of the uncategorized non-transfer rows; the rest of each cell is money out. */
export async function readUncategorizedIn(connection: ConnectionInstance, today: string): Promise<DatedAmount[]> {
  const response = await runQuery<Response<PerAccountMonth>>(connection, {
    ActualQLquery: {
      table: "transactions",
      filter: { $and: [upToToday(today), notStarting, { category: null }, { "payee.transfer_acct": null }, { amount: { $gt: 0 } }] },
      groupBy: [{ $month: "$date" }, "account"],
      select: [{ month: { $month: "$date" } }, "account", { amt: { $sum: "$amount" } }],
    },
  });
  return response.data.map((r) => ({ month: r.month, accountId: r.account, amountMinor: r.amt }));
}

type EntryResult = { id: string; date: string; amount: number; account: string; category: string | null; notes: string | null; payee: string | null };

/** The non-transfer rows of the given asset accounts (those registered in the Asset Registry), to read their classifications. */
export async function readAssetEntries(connection: ConnectionInstance, accountIds: readonly string[], today: string): Promise<AssetEntry[]> {
  if (accountIds.length === 0) return [];
  const response = await runQuery<Response<EntryResult>>(connection, {
    ActualQLquery: {
      table: "transactions",
      filter: { $and: [{ account: { $oneof: [...accountIds] } }, upToToday(today), notStarting, { "payee.transfer_acct": null }] },
      select: ["id", "date", "amount", "account", "category", "notes", "payee"],
    },
  });
  return response.data.map((r) => ({ id: r.id, date: r.date, accountId: r.account, categoryId: r.category, amountMinor: r.amount, notes: r.notes, payeeId: r.payee }));
}

type LinkedResult = { id: string; date: string; amount: number; account: string; category: string | null; payee: string | null };

/** The rows the Asset Registry links to an asset sale, so they can be taken out of income and spending. */
export async function readLinkedSales(connection: ConnectionInstance, transactionIds: readonly string[], today: string): Promise<ReclassifiedRow[]> {
  if (transactionIds.length === 0) return [];
  const response = await runQuery<Response<LinkedResult>>(connection, {
    ActualQLquery: {
      table: "transactions",
      // A row Actual has since turned into a transfer is in transit, not a sale: it is left out here so it is not taken out twice.
      filter: { $and: [{ id: { $oneof: [...transactionIds] } }, upToToday(today), { "payee.transfer_acct": null }] },
      select: ["id", "date", "amount", "account", "category", "payee"],
    },
  });
  return response.data.map((r) => ({ id: r.id, payeeId: r.payee, month: r.date.slice(0, 7), accountId: r.account, categoryId: r.category, amountMinor: r.amount, to: "assetSale" as const }));
}

/** The interest and fee lines the Loans tracking recorded: read by id, so only those rows are ever taken out of spending. */
export async function readLoanCostRows(connection: ConnectionInstance, tags: readonly { id: string; loanAccountId: string; kind?: "interest" | "fee" }[], today: string): Promise<LoanCostRow[]> {
  const transactionIds = tags.map((t) => t.id);
  const tagOf = new Map(tags.map((t) => [t.id, t]));
  if (transactionIds.length === 0) return [];
  const response = await runQuery<Response<LinkedResult>>(connection, {
    ActualQLquery: {
      table: "transactions",
      // A row Actual has since turned into a transfer is not a cost: it is left out so it is not taken out of spending twice.
      filter: { $and: [{ id: { $oneof: [...new Set(transactionIds)] } }, upToToday(today), { "payee.transfer_acct": null }] },
      select: ["id", "date", "amount", "account", "category"],
    },
  });
  return response.data.map((r) => ({ month: r.date.slice(0, 7), accountId: r.account, categoryId: r.category, amountMinor: r.amount, loanAccountId: tagOf.get(r.id)?.loanAccountId, kind: tagOf.get(r.id)?.kind }));
}

type PayeeResult = { payee: string | null; category: string; account: string; is_child: boolean | number | null; amt: number; n: number };

/** Categorized, non-transfer rows by payee, category and account, between two dates (never past today). Read when the Spending tab opens. */
export async function readPayeeRows(connection: ConnectionInstance, startDate: string, endDate: string, today: string): Promise<PayeeRow[]> {
  const response = await runQuery<Response<PayeeResult>>(connection, {
    ActualQLquery: {
      table: "transactions",
      filter: { $and: [{ date: { $gte: startDate } }, { date: { $lte: endDate < today ? endDate : today } }, notStarting, { "payee.transfer_acct": null }, { category: { $ne: null } }] },
      groupBy: ["payee", "category", "account", "is_child"],
      select: ["payee", "category", "account", "is_child", { amt: { $sum: "$amount" } }, { n: { $count: "$id" } }],
    },
  });
  return response.data.map((r) => ({ payeeId: r.payee, categoryId: r.category, accountId: r.account, amountMinor: r.amt, count: r.n, isChild: r.is_child === true || r.is_child === 1 }));
}

type TransferResult = { id: string; date: string; account: string; amount: number; transfer_id: string | null; "payee.transfer_acct": string };

/** The transfer rows of the period between two sets of accounts, to explain what is in transit. Read only when asked for. */
export async function readTransferRows(connection: ConnectionInstance, input: { accountIds: readonly string[]; counterpartIds: readonly string[]; startDate: string; endDate: string; today: string }): Promise<TransferRow[]> {
  if (input.accountIds.length === 0 || input.counterpartIds.length === 0) return [];
  const response = await runQuery<Response<TransferResult>>(connection, {
    ActualQLquery: {
      table: "transactions",
      filter: { $and: [{ date: { $gte: input.startDate } }, { date: { $lte: input.endDate < input.today ? input.endDate : input.today } }, notStarting, { account: { $oneof: [...input.accountIds] } }, { "payee.transfer_acct": { $oneof: [...input.counterpartIds] } }] },
      select: ["id", "date", "account", "amount", "transfer_id", "payee.transfer_acct"],
    },
  });
  return response.data.map((r) => ({ id: r.id, date: r.date, accountId: r.account, amountMinor: r.amount, transferId: r.transfer_id, counterpartAccountId: r["payee.transfer_acct"] }));
}

/** Date, account and amount of some transactions, by id (the other sides of transfers). */
export async function readOtherSides(connection: ConnectionInstance, ids: readonly string[]): Promise<Map<string, OtherSide>> {
  const out = new Map<string, OtherSide>();
  for (let i = 0; i < ids.length; i += 400) {
    const response = await runQuery<Response<{ id: string; date: string; account: string; amount: number }>>(connection, {
      ActualQLquery: { table: "transactions", filter: { id: { $oneof: ids.slice(i, i + 400) } }, select: ["id", "date", "account", "amount"] },
    });
    for (const r of response.data) out.set(r.id, { date: r.date, accountId: r.account, amountMinor: r.amount });
  }
  return out;
}
