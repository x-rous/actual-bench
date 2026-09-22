"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnectionStore } from "@/store/connection";
import * as api from "../lib/reconciliationApi";

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

export function usePdfStatementLayouts(accountId?: string) {
  const budgetSyncId = useActiveBudgetSyncId();
  return useQuery({
    queryKey: pdfStatementLayoutsKey(budgetSyncId ?? "", accountId ?? ""),
    queryFn: () => api.listPdfStatementLayouts(budgetSyncId!, accountId!),
    enabled: Boolean(budgetSyncId && accountId),
  });
}

export function useReconciliationMutations() {
  const queryClient = useQueryClient();
  const budgetSyncId = useActiveBudgetSyncId();

  const invalidateSessions = () =>
    queryClient.invalidateQueries({ queryKey: sessionsKey(budgetSyncId ?? "") });
  const invalidateSession = (id: string) =>
    queryClient.invalidateQueries({ queryKey: sessionKey(id) });

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
      api.updateSession(id, payload),
    onSuccess: (_result, variables) => {
      invalidateSessions();
      void invalidateSession(variables.id);
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
      await api.putStatementRows(input.sessionId, input.statementRows);
      await api.putItems(input.sessionId, input.items);
      return api.updateSession(input.sessionId, input.patch);
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
      api.putItems(sessionId, items),
    onSuccess: (_result, variables) => invalidateSession(variables.sessionId),
  });

  const patchItem = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown; sessionId: string }) =>
      api.patchItem(id, payload),
    onSuccess: (_result, variables) => invalidateSession(variables.sessionId),
  });

  return {
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
    replaceItems,
  };
}
