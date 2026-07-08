"use client";

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import { isBrowserApiConnection, useConnectionStore } from "@/store/connection";
import * as api from "../lib/syncApi";
import type { BrowserApiConnection } from "@/store/connection";
import type { SyncFlowRun } from "@/lib/app-db/types";

/** Direct (browser-api) connections available for source/target selection. */
export function useDirectConnections(): BrowserApiConnection[] {
  const instances = useConnectionStore((s) => s.instances);
  return useMemo(() => instances.filter(isBrowserApiConnection), [instances]);
}

export function useConnectionById(connectionId: string): BrowserApiConnection | undefined {
  const connections = useDirectConnections();
  return connections.find((c) => c.id === connectionId);
}

/** Accounts for a chosen Direct connection (opens that budget via the transport). */
export function useFlowAccounts(connectionId: string) {
  const connection = useConnectionById(connectionId);
  return useQuery({
    queryKey: ["sync-flow-accounts", connectionId],
    queryFn: async () => {
      if (!connection) return [];
      return getTransport(connection).getAccounts();
    },
    enabled: !!connection,
  });
}

/** Persisted items + summary for a preview/apply run. */
export function useSyncRun(runId: string | null) {
  return useQuery({
    queryKey: ["sync-run", runId],
    queryFn: async () => (runId ? api.getRun(runId) : null),
    enabled: !!runId,
  });
}

/** Run history for a flow. */
export function useFlowRuns(flowId: string | null) {
  return useQuery({
    queryKey: ["sync-flow-runs", flowId],
    queryFn: async () => (flowId ? (await api.listRuns(flowId)).runs : []),
    enabled: !!flowId,
  });
}

/**
 * Latest run per flow, for the flow-list status line.
 *
 * Queried per flow (newest run each) rather than sampling a global recent-runs
 * window: with many flows and a long history, a global cap could omit a flow's
 * latest run and make it look like it had never run.
 */
export function useLatestRunByFlow(flowIds: string[]) {
  return useQueries({
    queries: flowIds.map((flowId) => ({
      queryKey: ["sync-latest-run", flowId],
      queryFn: async (): Promise<SyncFlowRun | null> => {
        const { runs } = await api.listRuns(flowId, 1);
        return runs[0] ?? null;
      },
    })),
    combine: (results) => {
      const data = new Map<string, SyncFlowRun>();
      results.forEach((result, i) => {
        if (result.data) data.set(flowIds[i], result.data);
      });
      return {
        data,
        refetch: () => results.forEach((result) => result.refetch()),
      };
    },
  });
}
