"use client";
import { useQueries, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import type { ConnectionInstance } from "@/store/connection";
import { bankToday, cardActivityWindow } from "../lib/cycles";
import { readCardActivity } from "../lib/activity";
import { planAccountIds } from "../lib/derive/planAccounts";
import type { Card, Statement, Workspace } from "../lib/models";

/**
 * Drops this account's cached reads for other windows once a new window is read. The window moves
 * with the date and the tracking start, and each old read is a full copy of the card's history.
 * Only inactive entries go, so nothing on screen is refetched.
 */
function dropOtherWindows(client: QueryClient, prefix: readonly unknown[], current: readonly unknown[]) {
  client.removeQueries({
    queryKey: prefix,
    type: "inactive",
    predicate: (query) => query.queryKey.slice(prefix.length).join("|") !== current.join("|"),
  });
}

export function useCreditCardActivities(connection: ConnectionInstance, cards: Card[], statements: Statement[] = []) {
  const client = useQueryClient();
  return useQueries({
    queries: cards.map((card) => {
      const today = bankToday(card.bankTimeZone);
      const { from, to } = cardActivityWindow(card, today, statements);
      return {
        queryKey: ["creditCardActivity", connection.id, connection.budgetSyncId, card.accountId, from, to],
        queryFn: async () => {
          const read = await readCardActivity(getTransport(connection), card.accountId, from, to);
          dropOtherWindows(client, ["creditCardActivity", connection.id, connection.budgetSyncId, card.accountId], [from, to]);
          return read;
        },
        enabled: from <= to,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      };
    }),
  });
}

/** Plan accounts (D6) are read once per budget and account, independently of the card windows. */
export function useCreditCardPlanAccounts(connection: ConnectionInstance, workspace: Pick<Workspace, "planAccounts" | "plans">, to: string) {
  const client = useQueryClient();
  const ids = [...planAccountIds(workspace)].sort();
  return useQueries({
    queries: ids.map((accountId) => ({
      queryKey: ["creditCardTracking", connection.id, connection.budgetSyncId, accountId, to],
      queryFn: async () => {
        const read = await readCardActivity(getTransport(connection), accountId, "1900-01-01", to);
        dropOtherWindows(client, ["creditCardTracking", connection.id, connection.budgetSyncId, accountId], [to]);
        return read;
      },
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  });
}
