"use client";

import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import { DEFAULT_BUFFER_SETTINGS, type BufferSettings } from "@/lib/financial-insights/bufferScenario";

/**
 * The cash buffer settings of the active budget (the months of cover the user aims for, and how a typical month is worked out),
 * kept in the app database and never written to Actual. Until they are read, the defaults apply; if they cannot be read, the user is told
 * that the defaults are in use rather than being left to assume their saved choice applies.
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
  // The same id from every place that mounts this hook, so one failure is one message.
  useEffect(() => { if (query.isError) toast.error("Could not load your cash buffer settings, so the defaults are used", { id: "cash-buffer-settings-load" }); }, [query.isError]);

  // The screen follows the latest choice at once. Whatever order the responses arrive in, the settings are read again once a save
  // settles, so the screen ends on what the database holds, never on an older response that arrived last.
  const mutation = useMutation({
    mutationFn: async ({ budget, settings }: { budget: string; settings: BufferSettings }): Promise<BufferSettings> => {
      const response = await fetch("/api/cash-buffer-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ budgetSyncId: budget, settings }) });
      if (!response.ok) throw new Error("Could not save the cash buffer settings");
      return ((await response.json()) as { settings: BufferSettings }).settings;
    },
    onMutate: async ({ budget, settings }) => {
      await queryClient.cancelQueries({ queryKey: ["cashBufferSettings", budget] });
      queryClient.setQueryData(["cashBufferSettings", budget], settings);
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: (_data, _error, { budget }) => queryClient.invalidateQueries({ queryKey: ["cashBufferSettings", budget] }),
  });

  return {
    settings: query.data ?? DEFAULT_BUFFER_SETTINGS,
    save: (settings: BufferSettings) => { if (budgetSyncId) mutation.mutate({ budget: budgetSyncId, settings }); },
    saving: mutation.isPending,
  };
}
