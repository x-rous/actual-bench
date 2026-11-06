"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { readStatementEntries } from "@/lib/financial-insights/statementReads";
import { buildStatements } from "@/lib/financial-insights/statements";
import type { ReadyData } from "./useFinancialInsights";

/** Detailed evidence loads only when Statements opens. Refresh shares the main snapshot's invalidation and read timestamp. */
export function useStatements(data: ReadyData) {
  const connection = useConnectionStore(selectActiveInstance);
  const query = useQuery({
    queryKey: ["financial-insights", "statements", connection?.id, connection?.budgetSyncId, data.readAt, data.period.startDate, data.period.endDate],
    enabled: !!connection?.budgetSyncId && !data.refreshing,
    staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: ({ signal }) => {
      if (!connection) throw new Error("No active connection");
      return readStatementEntries(connection, data.period, signal);
    },
  });
  const model = useMemo(() => query.data ? buildStatements({
    ledger: data.ledger, period: data.period, categories: data.categories, entries: query.data,
    assetEntries: data.registry.assetEntries, savedClassifications: data.registry.savedClassifications,
    basisIssue: data.summary.moneyKept.state === "ready" ? null : data.summary.moneyKept.reason,
  }) : null, [query.data, data]);
  return { model, isError: query.isError, retry: () => void query.refetch() };
}
