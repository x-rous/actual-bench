"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { apiRequest } from "@/lib/api/client";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { budgetMonthDataQueryOptions } from "./useMonthData";
import type {
  BudgetCellKey,
  BudgetSaveResult,
  LoadedMonthState,
  StagedBudgetEdit,
} from "../types";

/**
 * Returns a new LoadedMonthState with the given category's budgeted set to
 * `budgeted`, propagating the delta to its parent group and to the relevant
 * summary fields. Pure — produces a shallow-cloned state without mutating
 * the input. Used for optimistic cache updates after a successful PATCH.
 */
function applyBudgetedToMonthState(
  state: LoadedMonthState,
  categoryId: string,
  budgeted: number
): LoadedMonthState {
  const cat = state.categoriesById[categoryId];
  if (!cat) return state;
  const delta = budgeted - cat.budgeted;
  if (delta === 0) return state;

  const nextCat = { ...cat, budgeted, balance: cat.balance + delta };
  const group = state.groupsById[cat.groupId];
  const nextGroup = group
    ? { ...group, budgeted: group.budgeted + delta, balance: group.balance + delta }
    : group;
  const nextSummary = {
    ...state.summary,
    totalBudgeted: state.summary.totalBudgeted - delta,
    totalBalance: state.summary.totalBalance + delta,
    toBudget: state.summary.toBudget - delta,
  };

  return {
    summary: nextSummary,
    groupsById: nextGroup
      ? { ...state.groupsById, [cat.groupId]: nextGroup }
      : state.groupsById,
    categoriesById: { ...state.categoriesById, [categoryId]: nextCat },
    groupOrder: state.groupOrder,
  };
}

type SaveProgress = {
  completed: number;
  total: number;
};

type UseBudgetSaveReturn = {
  save: (
    edits: Record<BudgetCellKey, StagedBudgetEdit>
  ) => Promise<BudgetSaveResult[]>;
  isSaving: boolean;
  progress: SaveProgress;
};

/**
 * Feature-local save pipeline for budget cell edits.
 *
 * Issues PATCH /months/{month}/categories/{categoryId} calls sequentially
 * (never in parallel) so the server's budget sync state is not raced.
 *
 * Pre-save: re-fetches GET /months to verify all target months still exist.
 * Progress: exposes { completed, total } updated after each PATCH.
 * Clearing: only keys that received a 200 are removed from the store —
 * failed keys remain with their saveError set, visible in the grid.
 */
export function useBudgetSave(): UseBudgetSaveReturn {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  const clearEditsForKeys = useBudgetEditsStore((s) => s.clearEditsForKeys);
  const setSaveError = useBudgetEditsStore((s) => s.setSaveError);

  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState<SaveProgress>({ completed: 0, total: 0 });

  const save = useCallback(
    async (
      edits: Record<BudgetCellKey, StagedBudgetEdit>
    ): Promise<BudgetSaveResult[]> => {
      if (!connection) throw new Error("No active connection");

      const entries = Object.entries(edits) as [BudgetCellKey, StagedBudgetEdit][];
      if (entries.length === 0) return [];

      // Pre-save guard: verify all target months still exist in GET /months.
      const monthsResult = await apiRequest<{ data: string[] }>(connection, "/months");
      const availableSet = new Set(monthsResult.data);

      const monthValidEntries = entries.filter(([, edit]) => availableSet.has(edit.month));
      const monthInvalidEntries = entries.filter(([, edit]) => !availableSet.has(edit.month));

      const results: BudgetSaveResult[] = monthInvalidEntries.map(([, edit]) => ({
        month: edit.month,
        categoryId: edit.categoryId,
        status: "error",
        message: `Month ${edit.month} is no longer available in this budget`,
      }));

      // Pre-save guard: verify each edit's category still exists. We fetch one
      // valid month's data (or read it from the TanStack Query cache, which the
      // workspace has already warmed) and treat its categoriesById as the
      // authoritative category list for this budget — the same set is returned
      // for every month, so a single fetch suffices.
      let validCategoryIds: Set<string> | null = null;
      const probeMonth = monthValidEntries[0]?.[1].month;
      if (probeMonth) {
        try {
          const monthState = await queryClient.fetchQuery(
            budgetMonthDataQueryOptions(connection, probeMonth)
          );
          validCategoryIds = new Set(Object.keys(monthState.categoriesById));
        } catch {
          // If we can't load any month, fall through and let per-PATCH errors
          // surface deleted-category failures with the server's own message.
        }
      }

      const validEntries: [BudgetCellKey, StagedBudgetEdit][] = [];
      for (const entry of monthValidEntries) {
        const [key, edit] = entry;
        if (validCategoryIds && !validCategoryIds.has(edit.categoryId)) {
          const message =
            "Category was removed from this budget — discard the staged edit to continue.";
          setSaveError(key, message);
          results.push({
            month: edit.month,
            categoryId: edit.categoryId,
            status: "error",
            message,
          });
          continue;
        }
        validEntries.push(entry);
      }

      // Snapshot the value being saved for each key. After the loop we only
      // clear edits whose stored value still matches this snapshot, so any
      // mid-save edit the user types into the same cell is preserved.
      const saveSnapshot = new Map<BudgetCellKey, number>();
      for (const [key, edit] of validEntries) {
        saveSnapshot.set(key, edit.nextBudgeted);
      }

      setIsSaving(true);
      setProgress({ completed: 0, total: validEntries.length });

      const succeededKeys: BudgetCellKey[] = [];
      const successMonths = new Set<string>();

      for (let i = 0; i < validEntries.length; i++) {
        const entry = validEntries[i];
        if (!entry) continue;
        const [key, edit] = entry;

        try {
          await apiRequest(connection, `/months/${edit.month}/categories/${edit.categoryId}`, {
            method: "PATCH",
            body: { category: { budgeted: edit.nextBudgeted } },
          });

          // BM-11: Optimistically update the cached month state so the grid
          // clears the amber "staged" styling immediately, without waiting for
          // the invalidation refetch round trip. The server is still the source
          // of truth — the parallel invalidation below will reconcile.
          queryClient.setQueryData(
            ["budget-month-data", connection.id, edit.month],
            (prev: LoadedMonthState | undefined) =>
              prev ? applyBudgetedToMonthState(prev, edit.categoryId, edit.nextBudgeted) : prev
          );

          succeededKeys.push(key);
          successMonths.add(edit.month);
          results.push({
            month: edit.month,
            categoryId: edit.categoryId,
            status: "success",
          });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Save failed";
          setSaveError(key, message);
          results.push({
            month: edit.month,
            categoryId: edit.categoryId,
            status: "error",
            message,
          });
        }

        setProgress({ completed: i + 1, total: validEntries.length });
      }

      // Clear only the keys that actually succeeded AND whose stored value
      // still matches the snapshot taken at save-enqueue time. Anything the
      // user re-edited mid-save stays in the store with the newer value.
      if (succeededKeys.length > 0) {
        const currentEdits = useBudgetEditsStore.getState().edits;
        const safeToClear = succeededKeys.filter((k) => {
          const current = currentEdits[k];
          if (!current) return true;
          return current.nextBudgeted === saveSnapshot.get(k);
        });
        if (safeToClear.length > 0) {
          clearEditsForKeys(safeToClear);
        }
        // BM-11: Invalidate in parallel — invalidations are read-side and
        // independent. The optimistic updates above already cleared the UI;
        // these refetches reconcile against the server.
        await Promise.all(
          Array.from(successMonths).map((month) =>
            queryClient.invalidateQueries({
              queryKey: ["budget-month-data", connection.id, month],
            })
          )
        );
      }

      setIsSaving(false);
      setProgress({ completed: 0, total: 0 });

      return results;
    },
    [connection, queryClient, clearEditsForKeys, setSaveError]
  );

  return { save, isSaving, progress };
}
