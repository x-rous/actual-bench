"use client";

import { useQuery } from "@tanstack/react-query";
import { runQuery } from "@/lib/api/query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import type { AccountActivity } from "@/lib/account-class/reporting";

type ActivityRow = { account: string; n: number; s: number };

/**
 * How many transactions each given account has ever had, and their sum (minor
 * units): one grouped ActualQL query, the same in Direct and HTTP. Used to tell a
 * closed account with no history, which needs no class, from one with history.
 * Accounts with no transactions are absent from the query, so they are filled in
 * as empty here. `data` is undefined while loading or if the read failed.
 */
export function useClosedAccountActivity(accountIds: readonly string[]) {
  const connection = useConnectionStore(selectActiveInstance);
  const ids = [...accountIds].sort();

  return useQuery({
    queryKey: ["accountActivity", connection?.id, connection?.budgetSyncId, ids],
    queryFn: async (): Promise<Map<string, AccountActivity>> => {
      const result = new Map<string, AccountActivity>(ids.map((id) => [id, { count: 0, balanceMinor: 0 }]));
      if (ids.length === 0 || !connection) return result;
      const response = await runQuery<{ data: ActivityRow[] }>(connection, {
        ActualQLquery: {
          table: "transactions",
          filter: { account: { $oneof: ids } },
          groupBy: ["account"],
          select: ["account", { n: { $count: "$id" } }, { s: { $sum: "$amount" } }],
        },
      });
      for (const row of response.data) result.set(row.account, { count: row.n, balanceMinor: row.s });
      return result;
    },
    enabled: Boolean(connection),
  });
}
