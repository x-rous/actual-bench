"use client";
import { useQueries } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import type { ConnectionInstance } from "@/store/connection";
import { bankToday, cardActivityWindow } from "../lib/cycles";
import { readCardActivity } from "../lib/activity";
import { planAccountIds } from "../lib/derive/planAccounts";
import type { Card, Statement, Workspace } from "../lib/models";

export function useCreditCardActivities(connection: ConnectionInstance, cards: Card[], statements: Statement[] = []) {
  return useQueries({
    queries: cards.map((card) => {
      const today = bankToday(card.bankTimeZone);
      const { from, to } = cardActivityWindow(card, today, statements);
      return {
        queryKey: ["creditCardActivity", connection.id, connection.budgetSyncId, card.accountId, from, to],
        queryFn: () => readCardActivity(getTransport(connection), card.accountId, from, to),
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
  const ids = [...planAccountIds(workspace)].sort();
  return useQueries({
    queries: ids.map((accountId) => ({
      queryKey: ["creditCardTracking", connection.id, connection.budgetSyncId, accountId, to],
      queryFn: () => readCardActivity(getTransport(connection), accountId, "1900-01-01", to),
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  });
}
