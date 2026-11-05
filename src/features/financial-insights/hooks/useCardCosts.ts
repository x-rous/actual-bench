"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { httpPersistence } from "@/features/credit-cards/lib/store/persistence";
import type { CardCategories } from "@/lib/financial-insights/debt";

export type CardCostSettings =
  | { state: "loading" }
  /** The app database could not be read: the chart says so and the rest of the tab is unaffected. */
  | { state: "unavailable" }
  | { state: "ready"; cards: CardCategories[] };

/**
 * Which categories the Credit Cards module maps to each card's interest and fees, read from the app database when Loans & cards
 * opens (the Credit Cards module's own read, display only). Nothing is written.
 */
export function useCardCosts(enabled: boolean): CardCostSettings {
  const connection = useConnectionStore(selectActiveInstance);
  const query = useQuery({
    queryKey: ["financial-insights", "card-categories", connection?.id, connection?.budgetSyncId],
    enabled: enabled && !!connection?.budgetSyncId,
    refetchOnMount: "always",
    retry: false,
    queryFn: () => httpPersistence.read(connection!.budgetSyncId),
  });
  return useMemo((): CardCostSettings => {
    if (query.isError) return { state: "unavailable" };
    if (!query.data) return { state: "loading" };
    return { state: "ready", cards: query.data.cards.map((c) => ({ accountId: c.accountId, interestCategoryId: c.interestCategoryId, feeCategoryId: c.feeCategoryId })) };
  }, [query.data, query.isError]);
}
