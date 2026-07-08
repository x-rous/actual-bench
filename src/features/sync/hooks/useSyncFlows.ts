"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../lib/syncApi";
import type { JsonObject, SyncFlow } from "@/lib/app-db/types";

const FLOWS_KEY = ["sync-flows"] as const;

export function useSyncFlows() {
  return useQuery({
    queryKey: FLOWS_KEY,
    queryFn: async () => (await api.listFlows()).flows,
  });
}

export function useSyncFlowMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: FLOWS_KEY });

  const create = useMutation({
    mutationFn: (payload: JsonObject) => api.createFlow(payload),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ flowId, payload }: { flowId: string; payload: JsonObject }) =>
      api.updateFlow(flowId, payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (flowId: string) => api.deleteFlow(flowId),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

export type { SyncFlow };
