"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import type { CashBufferScenarioRecord } from "@/lib/app-db/types";
import { usePersistedFilters } from "@/hooks/usePersistedFilters";
import { generateId } from "@/lib/uuid";
import { deleteCashBufferScenario, saveCashBufferScenario } from "../lib/cashBufferScenariosApi";

/**
 * The cash buffer scenarios of the active budget, kept in the app database (never written to Actual), and which one the card shows.
 * `activeId` is null for the real buffer; an id that no longer exists is treated as null.
 */
export function useCashBufferScenarios() {
  const connection = useConnectionStore(selectActiveInstance);
  const budgetSyncId = connection?.budgetSyncId ?? null;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["cashBufferScenarios", budgetSyncId], [budgetSyncId]);
  const [view, setView] = usePersistedFilters("filters:financial-insights-buffer", { activeId: null as string | null });

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<CashBufferScenarioRecord[]> => {
      const response = await fetch(`/api/cash-buffer-scenarios?budgetSyncId=${encodeURIComponent(budgetSyncId ?? "")}`);
      if (!response.ok) throw new Error("Could not load the cash buffer scenarios");
      return ((await response.json()) as { scenarios: CashBufferScenarioRecord[] }).scenarios;
    },
    enabled: Boolean(budgetSyncId),
  });
  const scenarios = useMemo(() => query.data ?? [], [query.data]);
  const active = scenarios.find((s) => s.id === view.activeId) ?? null;

  const save = useMutation({
    mutationFn: (input: Parameters<typeof saveCashBufferScenario>[0]) => saveCashBufferScenario(input),
    onSuccess: (list, input) => {
      queryClient.setQueryData(["cashBufferScenarios", input.budgetSyncId], list);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: ({ budget, id }: { budget: string; id: string }) => deleteCashBufferScenario(budget, id),
    onSuccess: (list, { budget }) => queryClient.setQueryData(["cashBufferScenarios", budget], list),
    onError: (error: Error) => toast.error(error.message),
  });

  return {
    scenarios, active, loading: query.isLoading, failed: query.isError,
    select: (id: string | null) => setView({ activeId: id }),
    /** Saves a scenario (a new one without an id), shows it, and returns it (null when the save failed). */
    saveScenario: async (input: Omit<Parameters<typeof saveCashBufferScenario>[0], "budgetSyncId">): Promise<CashBufferScenarioRecord | null> => {
      if (!budgetSyncId) return null;
      try {
        // A new scenario gets its id here, so the saved one is found by id and never guessed from the list.
        const id = input.id ?? generateId();
        const list = await save.mutateAsync({ ...input, id, budgetSyncId });
        const saved = list.find((s) => s.id === id);
        if (saved) setView({ activeId: saved.id });
        return saved ?? null;
      } catch { return null; }
    },
    deleteScenario: async (id: string) => {
      if (!budgetSyncId) return;
      try { await remove.mutateAsync({ budget: budgetSyncId, id }); if (view.activeId === id) setView({ activeId: null }); } catch { /* the toast says why */ }
    },
    saving: save.isPending || remove.isPending,
  };
}
