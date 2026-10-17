"use client";
import { useQueries } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import type { ConnectionInstance } from "@/store/connection";
import { bankToday, cardActivityWindow } from "../lib/cycles";
import { readCardActivity } from "../lib/activity";

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

/** Shared liability accounts are read once per budget/account, independently of the card windows. */
export function useCreditCardTracking(connection: ConnectionInstance, plans: import("../lib/models").RepaymentPlan[] = [], to: string) {
  const ids = [...new Set(plans.flatMap((plan) => plan.tracking ? [plan.tracking.accountId] : []))].sort();
  return useQueries({ queries: ids.map((accountId) => ({
    queryKey: ["creditCardTracking", connection.id, connection.budgetSyncId, accountId, to],
    queryFn: () => readCardActivity(getTransport(connection), accountId, "1900-01-01", to),
    staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })) });
}
