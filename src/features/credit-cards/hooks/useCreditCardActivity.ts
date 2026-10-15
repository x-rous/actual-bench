"use client";
import { useQuery, useQueries } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import type { ConnectionInstance } from "@/store/connection";
import { bankToday, cardActivityWindow } from "../lib/cycles";
import { readCardActivity } from "../lib/activity";

export function useCreditCardActivity(connection: ConnectionInstance, accountId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["creditCardActivity", connection.id, connection.budgetSyncId, accountId, from, to],
    queryFn: () => readCardActivity(getTransport(connection), accountId!, from, to),
    enabled: Boolean(accountId), staleTime: Infinity, gcTime: Infinity,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
}

export function useCreditCardActivities(connection: ConnectionInstance, cards: import("../lib/models").Card[], statements: import("../lib/models").Statement[] = []) {
  return useQueries({ queries: cards.map((card) => {
    const today = bankToday(card.bankTimeZone);
    const { from, to } = cardActivityWindow(card, today, statements);
    return {
      queryKey: ["creditCardActivity", connection.id, connection.budgetSyncId, card.accountId, from, to],
      queryFn: () => readCardActivity(getTransport(connection), card.accountId, from, to),
      enabled: from <= to, staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false,
    };
  }) });
}
