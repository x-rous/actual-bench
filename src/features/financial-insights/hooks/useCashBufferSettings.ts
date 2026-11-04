"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { DEFAULT_BUFFER_SETTINGS, type BufferSettings } from "@/lib/financial-insights/bufferScenario";

/**
 * The cash buffer settings of the active budget (the months of cover the user aims for, and how a typical month is worked out),
 * kept in the app database and never written to Actual. Until they are read, the defaults apply.
 */
export function useCashBufferSettings() {
  const connection = useConnectionStore(selectActiveInstance);
  const budgetSyncId = connection?.budgetSyncId ?? null;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["cashBufferSettings", budgetSyncId], [budgetSyncId]);

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<BufferSettings> => {
      const response = await fetch(`/api/cash-buffer-settings?budgetSyncId=${encodeURIComponent(budgetSyncId ?? "")}`);
      if (!response.ok) throw new Error("Could not load the cash buffer settings");
      return ((await response.json()) as { settings: BufferSettings }).settings;
    },
    enabled: Boolean(budgetSyncId),
  });

  const mutation = useMutation({
    mutationFn: async ({ budget, settings }: { budget: string; settings: BufferSettings }): Promise<BufferSettings> => {
      const response = await fetch("/api/cash-buffer-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ budgetSyncId: budget, settings }) });
      if (!response.ok) throw new Error("Could not save the cash buffer settings");
      return ((await response.json()) as { settings: BufferSettings }).settings;
    },
    onSuccess: (settings, { budget }) => queryClient.setQueryData(["cashBufferSettings", budget], settings),
    onError: (error: Error) => toast.error(error.message),
  });

  return {
    settings: query.data ?? DEFAULT_BUFFER_SETTINGS,
    save: (settings: BufferSettings) => { if (budgetSyncId) mutation.mutate({ budget: budgetSyncId, settings }); },
    saving: mutation.isPending,
  };
}
