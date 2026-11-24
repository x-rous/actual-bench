"use client";

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ensureTransportReady, getTransport } from "@/lib/actual";
import { useConnectionStore } from "@/store/connection";
import { getBudgetFileSyncCapabilities } from "@/lib/sync/capabilities";
import * as api from "../lib/syncApi";
import type { ConnectionInstance } from "@/store/connection";
import type { SyncFlowRun } from "@/lib/app-db/types";

/**
 * Connections eligible for Cross Budget Sync source/target selection - any mode
 * whose capability report is `supported` (Direct and HTTP API Server today).
 */
export function useSyncConnections(): ConnectionInstance[] {
  const instances = useConnectionStore((s) => s.instances);
  return useMemo(
    () => instances.filter((c) => getBudgetFileSyncCapabilities({ mode: c.mode }).supported),
    [instances]
  );
}

export function useConnectionById(connectionId: string): ConnectionInstance | undefined {
  const connections = useSyncConnections();
  return connections.find((c) => c.id === connectionId);
}

/**
 * A Direct runtime holds one budget at a time, so the source and target pickers of
 * a flow must read their accounts one after the other: read together, one switches
 * the runtime under the other and its list comes back empty.
 */
let directAccountReads: Promise<unknown> = Promise.resolve();

function inTurn<T>(connection: ConnectionInstance, read: () => Promise<T>): Promise<T> {
  if (connection.mode !== "browser-api") return read();
  const result = directAccountReads.then(read, read);
  directAccountReads = result.catch(() => undefined);
  return result;
}

/** Accounts for a chosen connection (opens that budget via the transport). */
export function useFlowAccounts(connectionId: string) {
  const connection = useConnectionById(connectionId);
  return useQuery({
    queryKey: ["sync-flow-accounts", connectionId],
    queryFn: async () => {
      if (!connection) return [];
      // A flow's budget is usually not the active one: open it explicitly, as
      // the sync run itself does (a Direct budget takes the tab's runtime).
      return inTurn(connection, async () => {
        await ensureTransportReady(connection);
        return getTransport(connection).getAccounts();
      });
    },
    enabled: !!connection,
  });
}

/**
 * The accounts of two budgets, read one after the other. A Direct runtime holds
 * one budget at a time, so two parallel reads would switch it under each other.
 */
export function useTwoBudgetAccounts(firstConnectionId: string, secondConnectionId: string) {
  const connections = useSyncConnections();
  const first = connections.find((c) => c.id === firstConnectionId);
  const second = connections.find((c) => c.id === secondConnectionId);
  return useQuery({
    queryKey: ["sync-two-budget-accounts", firstConnectionId, secondConnectionId],
    queryFn: async () => {
      const readAccounts = (connection: ConnectionInstance) => inTurn(connection, async () => {
        await ensureTransportReady(connection);
        return getTransport(connection).getAccounts();
      });
      const firstAccounts = await readAccounts(first!);
      const secondAccounts = await readAccounts(second!);
      return { first: firstAccounts, second: secondAccounts };
    },
    enabled: !!first && !!second && firstConnectionId !== secondConnectionId,
    retry: false,
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

/** Server vault status + enrolled credentials, for unattended arming/badges. */
export function useVaultStatus() {
  return useQuery({ queryKey: ["sync-vault-status"], queryFn: api.getVaultStatus, staleTime: 60_000 });
}

/**
 * Flows whose latest run needs a person. Reads only Bench's own database, so
 * polling cannot disturb staged edits, and unattended runs show up without a reload.
 */
export function useSyncAttention() {
  return useQuery({
    queryKey: ["sync-attention"],
    queryFn: async () => (await api.getSyncAttention()).entries,
    refetchInterval: 60_000,
    staleTime: 30_000,
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
