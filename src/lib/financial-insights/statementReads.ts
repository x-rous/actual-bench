import { getTransport } from "@/lib/actual";
import type { ConnectionInstance } from "@/store/connection";
import type { ResolvedPeriod } from "./period";
import type { StatementEntry } from "./statements";

const PAGE_SIZE = 2000;
type RawEntry = {
  id: string; date: string; account: string; category: string | null; amount: number;
  "payee.transfer_acct": string | null; "payee.name": string | null; transfer_id: string | null; parent_id: string | null;
};

/**
 * Recorded inline split children and ordinary rows, never split parents as well. Sequential, bounded pages through the
 * active transport (and its HTTP queue). No account filter: changing a saved class reuses the same evidence safely.
 */
export async function readStatementEntries(connection: ConnectionInstance, period: ResolvedPeriod, signal?: AbortSignal): Promise<StatementEntry[]> {
  const transport = getTransport(connection);
  const entries: StatementEntry[] = [];
  const seen = new Set<string>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    signal?.throwIfAborted();
    const response = await transport.runQuery<{ data: RawEntry[] }>({
      ActualQLquery: {
        table: "transactions", options: { splits: "inline" },
        filter: { $and: [{ date: { $gte: period.startDate } }, { date: { $lte: period.endDate } }] },
        select: ["id", "date", "account", "category", "amount", "payee.transfer_acct", "payee.name", "transfer_id", "parent_id"],
        orderBy: [{ date: "asc" }, { id: "asc" }], limit: PAGE_SIZE, offset,
      },
    });
    signal?.throwIfAborted();
    for (const row of response.data) {
      if (seen.has(row.id)) throw new Error("Statement transactions changed during the read; Refresh Financial Insights");
      seen.add(row.id);
      entries.push({
      id: row.id, date: row.date, accountId: row.account, categoryId: row.category, amountMinor: row.amount,
      transferAccountId: row["payee.transfer_acct"], transferId: row.transfer_id, parentId: row.parent_id,
      startingBalance: row["payee.name"] === "Starting Balance",
      });
    }
    if (response.data.length < PAGE_SIZE) return entries;
  }
}
