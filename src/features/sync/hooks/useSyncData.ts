"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTransport } from "@/lib/actual";
import { isBrowserApiConnection, useConnectionStore } from "@/store/connection";
import * as api from "../lib/syncApi";
import type { BrowserApiConnection } from "@/store/connection";

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
