"use client";

import { useState, useSyncExternalStore } from "react";
import { ReconciliationSaveQueue } from "../lib/saveQueue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnectionStore } from "@/store/connection";
import * as api from "../lib/reconciliationApi";
import { loadBalanceOn } from "../lib/loadCandidates";
import type { ConnectionInstance } from "@/store/connection";

/**
 * Reconciliation sessions are scoped to a budget, so every key carries the
 * budget's stable sync id — switching budgets must not show another budget's
 * sessions from cache.
 */
export function useActiveBudgetSyncId(): string | null {
  return useConnectionStore((state) => {
    const active = state.instances.find((instance) => instance.id === state.activeInstanceId);
    return active?.budgetSyncId ?? null;
  });
}

const sessionsKey = (budgetSyncId: string) => ["reconciliation", "sessions", budgetSyncId] as const;
const sessionKey = (id: string) => ["reconciliation", "session", id] as const;
const profilesKey = (budgetSyncId: string, accountId?: string) =>
  ["reconciliation", "profiles", budgetSyncId, accountId ?? "all"] as const;
const pdfStatementLayoutsKey = (budgetSyncId: string, accountId: string) =>
  ["reconciliation", "pdf-statement-layouts", budgetSyncId, accountId] as const;

export function useReconciliationSessions() {
  const budgetSyncId = useActiveBudgetSyncId();
  return useQuery({
    queryKey: sessionsKey(budgetSyncId ?? ""),
    queryFn: async () => (await api.listSessions(budgetSyncId!)).sessions,
    enabled: Boolean(budgetSyncId),
  });
}

export function useReconciliationSession(id: string | null) {
  return useQuery({
    queryKey: sessionKey(id ?? ""),
    queryFn: () => api.getSession(id!),
    enabled: Boolean(id),
  });
}

export function useReconciliationProfiles(accountId?: string) {
  const budgetSyncId = useActiveBudgetSyncId();
  return useQuery({
    queryKey: profilesKey(budgetSyncId ?? "", accountId),
    queryFn: async () => (await api.listProfiles(budgetSyncId!, accountId)).profiles,
    enabled: Boolean(budgetSyncId),
  });
}

const savedTransformsKey = (budgetSyncId: string) =>
  ["reconciliation", "saved-transforms", budgetSyncId] as const;

/** The budget's saved transforms, in the order they run. */
export function useSavedTransforms() {
  const budgetSyncId = useActiveBudgetSyncId();
  return useQuery({
    queryKey: savedTransformsKey(budgetSyncId ?? ""),
    queryFn: async () => (await api.listSavedTransforms(budgetSyncId!)).transforms,
    enabled: Boolean(budgetSyncId),
  });
}

/** Create, update, reorder and delete saved transforms for the active budget. */
export function useSavedTransformMutations() {
  const budgetSyncId = useActiveBudgetSyncId();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: savedTransformsKey(budgetSyncId ?? "") });
  return {
    create: useMutation({
      mutationFn: (payload: Omit<Parameters<typeof api.createSavedTransform>[0], "budgetSyncId">) =>
        api.createSavedTransform({ budgetSyncId: budgetSyncId!, ...payload }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (payload: Omit<Parameters<typeof api.updateSavedTransform>[0], "budgetSyncId">) =>
        api.updateSavedTransform({ budgetSyncId: budgetSyncId!, ...payload }),
      onSuccess: refresh,
    }),
    reorder: useMutation({
      mutationFn: (ids: string[]) => api.reorderSavedTransforms({ budgetSyncId: budgetSyncId!, ids }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.deleteSavedTransform({ budgetSyncId: budgetSyncId!, id }),
      onSuccess: refresh,
    }),
  };
}

export function usePdfStatementLayouts(accountId?: string) {
  const budgetSyncId = useActiveBudgetSyncId();
  return useQuery({
    queryKey: pdfStatementLayoutsKey(budgetSyncId ?? "", accountId ?? ""),
    queryFn: () => api.listPdfStatementLayouts(budgetSyncId!, accountId!),
    enabled: Boolean(budgetSyncId && accountId),
  });
}

/**
 * An account's balance at the end of a date, for the statement's closing
 * balance check. Read once per account and date; invalidated after an Apply
 * (`["reconciliation", "balance-on", connectionId]`).
 */
export function useBalanceOnDate(input: {
  connection: ConnectionInstance | null;
  sessionBudgetSyncId: string | null;
  accountId: string | null;
  asOf: string | null;
}) {
  const { connection, sessionBudgetSyncId, accountId, asOf } = input;
  return useQuery({
    queryKey: ["reconciliation", "balance-on", connection?.id ?? "", connection?.budgetSyncId ?? "", accountId ?? "", asOf ?? ""],
    queryFn: () => loadBalanceOn(connection!, accountId!, asOf!),
    enabled: Boolean(connection && accountId && asOf && sessionBudgetSyncId === connection.budgetSyncId),
    retry: false,
  });
}

export function useReconciliationMutations() {
  const queryClient = useQueryClient();
  const [queue] = useState(() => new ReconciliationSaveQueue());
  const hasFailedSaves = useSyncExternalStore(queue.subscribe, () => queue.hasFailures, () => false);
  const budgetSyncId = useActiveBudgetSyncId();

  const invalidateSessions = () =>
    queryClient.invalidateQueries({ queryKey: sessionsKey(budgetSyncId ?? "") });
  const invalidateSession = (id: string) =>
    queryClient.invalidateQueries({ queryKey: sessionKey(id) });

  /*
   * After an ordinary save: take the session record the server returned and
   * mark the rest stale without refetching it.
   *
   * Every decision used to refetch the whole session — every statement row with
   * its raw source and every item with its Actual snapshot — although the page
   * already holds what was saved. On a large statement that was megabytes per
   * click, queued behind the next save. A later open reads it fresh anyway
   * (`loadSession` uses `staleTime: 0`).
   */
  const settleSave = (id: string, response: unknown) => {
    const session = (response as { session?: Awaited<ReturnType<typeof api.getSession>>["session"] } | null)?.session;
    if (session) {
      queryClient.setQueryData<Awaited<ReturnType<typeof api.getSession>>>(sessionKey(id), (current) =>
        current ? { ...current, session } : current);
    }
    return queryClient.invalidateQueries({ queryKey: sessionKey(id), refetchType: "none" });
  };

  const createSession = useMutation({
    mutationFn: (payload: {
      accountId: string;
      accountName?: string;
      statementName?: string;
      tag?: string | null;
    }) =>
      api.createSession({ budgetSyncId: budgetSyncId!, ...payload }),
    onSuccess: invalidateSessions,
  });

  const updateSession = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof api.updateSession>[1] }) =>
      queue.enqueue(() => api.updateSession(id, payload)),
    onSuccess: (result, variables) => {
      invalidateSessions();
      void settleSave(variables.id, result);
    },
  });

  const deleteSession = useMutation({
    mutationFn: (id: string) => api.deleteSession(id),
    onSuccess: invalidateSessions,
  });

  /** Writes the parsed statement and the freshly built items in one step. */
  const saveParsedStatement = useMutation({
    mutationFn: async (input: {
      sessionId: string;
      statementRows: unknown[];
      items: unknown[];
      patch: Parameters<typeof api.updateSession>[1];
    }) => {
      return queue.enqueue(() => api.saveWork(input.sessionId, { statementRows: input.statementRows, items: input.items, patch: input.patch }));
    },
    onSuccess: (_result, variables) => {
      invalidateSessions();
      void invalidateSession(variables.sessionId);
    },
  });

  const saveProfile = useMutation({
    mutationFn: (payload: { accountId: string; name: string; mapping: unknown; matchConfig: unknown }) =>
      api.saveProfile({ budgetSyncId: budgetSyncId!, ...payload }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reconciliation", "profiles"] }),
  });

  const invalidatePdfStatementLayouts = () =>
    queryClient.invalidateQueries({ queryKey: ["reconciliation", "pdf-statement-layouts"] });

  const savePdfStatementLayout = useMutation({
    mutationFn: (payload: {
      accountId: string;
      bankName: string;
      layoutName: string;
      layout: unknown;
      mode: "create" | "update";
      assignToAccount?: boolean;
    }) => api.savePdfStatementLayout({ budgetSyncId: budgetSyncId!, ...payload }),
    onSuccess: invalidatePdfStatementLayouts,
  });

  const assignPdfStatementLayout = useMutation({
    mutationFn: (payload: { accountId: string; layoutId: string }) =>
      api.assignPdfStatementLayout({ budgetSyncId: budgetSyncId!, ...payload }),
    onSuccess: invalidatePdfStatementLayouts,
  });

  const removePdfStatementLayoutAssignment = useMutation({
    mutationFn: (payload: { accountId: string }) =>
      api.removePdfStatementLayoutAssignment({ budgetSyncId: budgetSyncId!, ...payload }),
    onSuccess: invalidatePdfStatementLayouts,
  });

  const renamePdfStatementLayoutBank = useMutation({
    mutationFn: api.renamePdfStatementLayoutBank,
    onSuccess: invalidatePdfStatementLayouts,
  });

  const renamePdfStatementLayout = useMutation({
    mutationFn: api.renamePdfStatementLayout,
    onSuccess: invalidatePdfStatementLayouts,
  });

  const deletePdfStatementLayout = useMutation({
    mutationFn: api.deletePdfStatementLayout,
    onSuccess: invalidatePdfStatementLayouts,
  });

  /** Rewrite the whole item set — used when a decision adds or removes rows. */
  const replaceItems = useMutation({
    mutationFn: ({ sessionId, items }: { sessionId: string; items: unknown[] }) =>
      queue.enqueue(() => api.saveWork(sessionId, { items })),
    onSuccess: (result, variables) => settleSave(variables.sessionId, result),
  });

  const patchItems = useMutation({
    mutationFn: ({ sessionId, items }: { sessionId: string; items: unknown[] }) =>
      queue.enqueue(() => api.saveWork(sessionId, { itemPatches: items })),
    onSuccess: (result, variables) => settleSave(variables.sessionId, result),
  });

  /** Only what changed: patched, added and removed items (see `diffItems`). */
  const saveItemDiff = useMutation({
    mutationFn: ({ sessionId, itemPatches, addedItems, removedItemIds }: {
      sessionId: string; itemPatches: unknown[]; addedItems: unknown[]; removedItemIds: string[];
    }) => queue.enqueue(() => api.saveWork(sessionId, { itemPatches, addedItems, removedItemIds })),
    onSuccess: (result, variables) => settleSave(variables.sessionId, result),
  });

  const patchItem = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown; sessionId: string }) =>
      queue.enqueue(() => api.patchItem(id, payload)),
    onSuccess: (_result, variables) => settleSave(variables.sessionId, null),
  });

  return {
    loadSession: (id: string) => queryClient.fetchQuery({ queryKey: sessionKey(id), queryFn: () => api.getSession(id), staleTime: 0 }),
    /** Puts a session the server has just returned into the cache, so the screen follows it without waiting for a read. */
    cacheSession: (session: Awaited<ReturnType<typeof api.getSession>>["session"]) =>
      queryClient.setQueryData<Awaited<ReturnType<typeof api.getSession>>>(sessionKey(session.id), (current) => (current ? { ...current, session } : current)),
    hasFailedSaves,
    flushSaves: () => queue.flush(),
    retrySaves: async (id?: string | null) => {
      await queue.retry();
      await invalidateSessions();
      if (id) await invalidateSession(id);
    },
    createSession,
    updateSession,
    deleteSession,
    saveParsedStatement,
    saveProfile,
    savePdfStatementLayout,
    assignPdfStatementLayout,
    removePdfStatementLayoutAssignment,
    renamePdfStatementLayoutBank,
    renamePdfStatementLayout,
    deletePdfStatementLayout,
    patchItem,
    patchItems,
    replaceItems,
    saveItemDiff,
  };
}
