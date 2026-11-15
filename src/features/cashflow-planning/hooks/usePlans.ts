"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { selectActiveInstance, useConnectionStore } from "@/store/connection";
import type { PlanDocument } from "@/lib/cashflow-planning/types";
import { PlanConflictError, deletePlan, listPlans, savePlan } from "../api";
import { hasUnsavedPlans, useCashflowStore } from "../store";

const ACTIVE_KEY = (budget: string) => `cashflow-planning:active:${budget}`;
const SAVE_DELAY_MS = 900;

/** Loads the budget's plans into the tab's working copies, once per budget. */
export function usePlans() {
  const connection = useConnectionStore(selectActiveInstance);
  const budgetSyncId = connection?.budgetSyncId ?? null;
  const hydrate = useCashflowStore((s) => s.hydrate);
  const loadedBudget = useCashflowStore((s) => s.budgetSyncId);
  const activeId = useCashflowStore((s) => s.activeId);

  const query = useQuery({
    queryKey: ["cashflow-plans", budgetSyncId],
    queryFn: () => listPlans(budgetSyncId!),
    enabled: !!budgetSyncId && loadedBudget !== budgetSyncId,
    // The tab's working copies are the truth once loaded; the list is only read to fill them.
    gcTime: 0,
  });

  useEffect(() => {
    if (!budgetSyncId || !query.data || loadedBudget === budgetSyncId) return;
    let preferred: string | null = null;
    try { preferred = sessionStorage.getItem(ACTIVE_KEY(budgetSyncId)); } catch { /* storage may be unavailable */ }
    hydrate(budgetSyncId, query.data.plans, preferred, query.data.unreadable);
  }, [budgetSyncId, query.data, loadedBudget, hydrate]);

  useEffect(() => {
    if (!budgetSyncId || !activeId || loadedBudget !== budgetSyncId) return;
    try { sessionStorage.setItem(ACTIVE_KEY(budgetSyncId), activeId); } catch { /* storage may be unavailable */ }
  }, [budgetSyncId, activeId, loadedBudget]);

  return { budgetSyncId, ready: !!budgetSyncId && loadedBudget === budgetSyncId, failed: query.isError, retry: query.refetch };
}

/**
 * Saves each plan shortly after its last edit, one save at a time per plan. A save that fails leaves the plan marked so and is
 * tried again on the next edit or on Retry; a plan changed in another tab is never overwritten without the user saying so.
 * Plain functions over the store, so nothing here depends on React's render cycle.
 */
export function createAutosave(budgetSyncId: string) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Set<string>();
  let disposed = false;
  /** The page is going away or hidden: a follow-up save then goes out at once, with keepalive. */
  let leaving = false;

  const schedule = (id: string) => {
    const existing = timers.get(id);
    if (existing) clearTimeout(existing);
    timers.set(id, setTimeout(() => { timers.delete(id); void save(id); }, SAVE_DELAY_MS));
  };

  /** `keepalive` is for a page that is really going away; the request layer drops it when the body is too large for it. */
  const save = async (id: string, force = false, keepalive = false) => {
    if (running.has(id)) return;
    const state = useCashflowStore.getState();
    const current = state.sessions[id];
    if (!current || state.budgetSyncId !== budgetSyncId || current.doc === current.saved) return;
    if (current.status === "conflict" && !force) return;
    running.add(id);
    const sent = current.doc;
    state.saving(id);
    try {
      const record = await savePlan({ budgetSyncId, id, baseRevision: current.revision, force, document: sent }, { keepalive });
      useCashflowStore.getState().savedAs(id, record, sent);
    } catch (error) {
      useCashflowStore.getState().failed(id, error instanceof PlanConflictError ? "conflict" : "error", error instanceof Error ? error.message : "Could not save the plan");
    } finally {
      running.delete(id);
      // Edits made while the save was on its way. After dispose, or on a page that is going away, no timer may be left
      // behind: the follow-up is sent directly, and `save` keeps it one at a time.
      if (useCashflowStore.getState().sessions[id]?.status === "dirty") {
        if (disposed || leaving) void save(id, false, leaving);
        else schedule(id);
      }
    }
  };

  /** Saves what is pending right away, through the same one-at-a-time path as every other save. */
  const flush = (keepalive: boolean) => {
    const state = useCashflowStore.getState();
    if (state.budgetSyncId !== budgetSyncId) return;
    for (const id of state.order) {
      const timer = timers.get(id);
      if (timer) { clearTimeout(timer); timers.delete(id); }
      void save(id, false, keepalive);
    }
  };

  // A plan left unsaved (a failed leave-save, or an error) is tried again as soon as the plans are open.
  for (const id of useCashflowStore.getState().order) {
    const s = useCashflowStore.getState().sessions[id];
    if (useCashflowStore.getState().budgetSyncId === budgetSyncId && s && s.doc !== s.saved && s.status !== "conflict") schedule(id);
  }

  const unsubscribe = useCashflowStore.subscribe((state, previous) => {
    for (const id of state.order) {
      const now = state.sessions[id], before = previous.sessions[id];
      if (now && now.doc !== before?.doc && now.doc !== now.saved && now.status !== "conflict") schedule(id);
    }
  });
  const beforeUnload = (event: BeforeUnloadEvent) => { if (hasUnsavedPlans()) { leaving = true; flush(true); event.preventDefault(); } };
  const hidden = () => {
    leaving = document.visibilityState === "hidden";
    if (leaving) flush(true);
  };
  window.addEventListener("beforeunload", beforeUnload);
  document.addEventListener("visibilitychange", hidden);

  return {
    save: (id: string, force = false) => void save(id, force),
    dispose: () => {
      unsubscribe();
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", hidden);
      // Leaving the page inside the app: the page is not unloading, so this is an ordinary save and a failure is recorded.
      flush(false);
      disposed = true;
      for (const timer of timers.values()) clearTimeout(timer);
    },
  };
}

export function usePlanAutosave(budgetSyncId: string | null) {
  const controller = useRef<ReturnType<typeof createAutosave> | null>(null);
  useEffect(() => {
    if (!budgetSyncId) return;
    const created = createAutosave(budgetSyncId);
    controller.current = created;
    return () => { created.dispose(); controller.current = null; };
  }, [budgetSyncId]);
  const retry = useCallback((id: string) => controller.current?.save(id), []);
  const overwrite = useCallback((id: string) => controller.current?.save(id, true), []);
  return { retry, overwrite };
}

/** Creating, copying and deleting plans go straight to the database: they are not edits of a plan. */
export function usePlanActions(budgetSyncId: string | null) {
  const create = useCallback(async (document: PlanDocument): Promise<string | null> => {
    if (!budgetSyncId) return null;
    try {
      const record = await savePlan({ budgetSyncId, document });
      useCashflowStore.getState().adopt(record);
      return record.id;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the plan");
      return null;
    }
  }, [budgetSyncId]);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    if (!budgetSyncId) return false;
    try {
      await deletePlan(budgetSyncId, id);
      useCashflowStore.getState().remove(id);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the plan");
      return false;
    }
  }, [budgetSyncId]);

  /** Deletes a stored plan this build cannot read. It is only removed, never repaired or rewritten. */
  const removeUnreadable = useCallback(async (id: string): Promise<void> => {
    if (!budgetSyncId) return;
    try {
      await deletePlan(budgetSyncId, id);
      useCashflowStore.getState().setUnreadable(useCashflowStore.getState().unreadable.filter((p) => p.id !== id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the plan");
    }
  }, [budgetSyncId]);

  /** Drops this tab's copy of a plan and reads what the database holds now. */
  const reload = useCallback(async (id: string): Promise<void> => {
    if (!budgetSyncId) return;
    try {
      const { plans, unreadable } = await listPlans(budgetSyncId);
      useCashflowStore.getState().setUnreadable(unreadable);
      const record = plans.find((p) => p.id === id);
      if (record) useCashflowStore.getState().adopt(record, false);
      else useCashflowStore.getState().remove(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reload the plan");
    }
  }, [budgetSyncId]);

  return { create, remove, reload, removeUnreadable };
}
