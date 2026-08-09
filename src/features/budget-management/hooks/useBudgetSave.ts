"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { getTransport } from "@/lib/actual";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { budgetMonthDataQueryOptions } from "./useMonthData";
import type {
  BudgetCellKey,
  BudgetSaveResult,
  LoadedMonthState,
  StagedBudgetEdit,
  StagedHold,
} from "../types";

/**
 * Returns a new LoadedMonthState with the given category's budgeted set to
 * `budgeted`, propagating the delta to its parent group and to the relevant
 * summary fields. Pure — produces a shallow-cloned state without mutating
 * the input. Used for optimistic cache updates after a successful PATCH.
 *
 * BM-12: this must project the same way the staged reducer
 * (`computeEffectiveMonthState` Layer 2) does, or the grid would jump when a
 * save clears the staged overlay. In Tracking mode an effectively-hidden
 * category is excluded from the summary aggregates, and a hidden category
 * inside a *visible* group must not pollute that group's totals either.
 */
export function applyBudgetedToMonthState(
  state: LoadedMonthState,
  categoryId: string,
  budgeted: number,
  isTracking: boolean
): LoadedMonthState {
  const cat = state.categoriesById[categoryId];
  if (!cat) return state;
  const delta = budgeted - cat.budgeted;
  if (delta === 0) return state;

  const nextCat = { ...cat, budgeted, balance: cat.balance + delta };
  const group = state.groupsById[cat.groupId];

  // A category is effectively hidden if its own flag is set OR its parent is.
  const effectivelyHidden = cat.hidden || (group?.hidden ?? false);
  // Tracking: a hidden category inside a visible group must not touch the
  // visible group's aggregate (mirrors effectiveMonth Layer 2's skip rule).
  const skipGroupUpdate =
    isTracking && effectivelyHidden && !(group?.hidden ?? false);
  const skipSummaryUpdate = isTracking && effectivelyHidden;

  const groupChanged = !!group && !skipGroupUpdate;
  const nextGroup = groupChanged
    ? { ...group, budgeted: group.budgeted + delta, balance: group.balance + delta }
    : group;

  const nextSummary = skipSummaryUpdate
    ? state.summary
    : {
        ...state.summary,
        totalBudgeted: state.summary.totalBudgeted - delta,
        totalBalance: state.summary.totalBalance + delta,
        toBudget: state.summary.toBudget - delta,
      };

  return {
    summary: nextSummary,
    groupsById: groupChanged
      ? { ...state.groupsById, [cat.groupId]: nextGroup! }
      : state.groupsById,
    categoriesById: { ...state.categoriesById, [categoryId]: nextCat },
    groupOrder: state.groupOrder,
    // Preserve income-budget provenance (BM-09): without it the optimistically
    // cached state would look like "unknown", and the effective-state overlay
    // would re-apply the reflect_budgets fallback to every income category,
    // letting a stale fallback overwrite the canonical monthly value.
    incomeBudgetFallbackIds: state.incomeBudgetFallbackIds,
  };
}

type SaveProgress = {
  completed: number;
  total: number;
};

type UseBudgetSaveReturn = {
  save: (
    edits: Record<BudgetCellKey, StagedBudgetEdit>,
    holds?: Record<string, StagedHold>
  ) => Promise<BudgetSaveResult[]>;
  isSaving: boolean;
  progress: SaveProgress;
};

/**
 * Feature-local save pipeline for budget cell edits.
 *
 * Save order (all sequential — never parallel):
 *   1. Complete transfer pairs → POST /months/{month}/categorytransfers (atomic)
 *   2. Incomplete transfer legs + standalone edits → PATCH per cell
 *
 * Using POST for complete pairs avoids the "onFinish called while inside a
 * spreadsheet transaction" server error that occurs when two PATCH calls for
 * the same transfer arrive before actual-http-api finishes its recalculation.
 *
 * Pre-save: re-fetches GET /months to verify all target months still exist.
 * Progress: exposes { completed, total } updated after each API call.
 * Clearing: only keys that received a 200 are removed from the store —
 * failed keys remain with their saveError set, visible in the grid.
 */
export function useBudgetSave(): UseBudgetSaveReturn {
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();
  const clearEditsForKeys = useBudgetEditsStore((s) => s.clearEditsForKeys);
  const clearHoldsForMonths = useBudgetEditsStore((s) => s.clearHoldsForMonths);
  const clearHistory = useBudgetEditsStore((s) => s.clearHistory);
  const setSaveError = useBudgetEditsStore((s) => s.setSaveError);
  const setHoldSaveError = useBudgetEditsStore((s) => s.setHoldSaveError);

  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState<SaveProgress>({ completed: 0, total: 0 });

  const save = useCallback(
    async (
      edits: Record<BudgetCellKey, StagedBudgetEdit>,
      holds: Record<string, StagedHold> = {}
    ): Promise<BudgetSaveResult[]> => {
      if (!connection) throw new Error("No active connection");
      const transport = getTransport(connection);
      // BM-12: project optimistic cache updates the same way the grid stages
      // them. Mode is synced into the store by BudgetManagementView.
      const isTracking =
        useBudgetEditsStore.getState().budgetMode === "tracking";

      const entries = Object.entries(edits) as [BudgetCellKey, StagedBudgetEdit][];
      const holdEntries = Object.entries(holds) as [string, StagedHold][];
      if (entries.length === 0 && holdEntries.length === 0) return [];

      // Pre-save guard: verify all target months still exist.
      const availableSet = new Set(await transport.getBudgetMonths());

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
            "Category was removed from this budget - discard the staged edit to continue.";
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

      // Group validEntries by transferGroupId to detect complete transfer pairs.
      const transferGroups = new Map<string, [BudgetCellKey, StagedBudgetEdit][]>();
      const nonTransferEntries: [BudgetCellKey, StagedBudgetEdit][] = [];

      for (const entry of validEntries) {
        const [, edit] = entry;
        if (edit.transferGroupId) {
          if (!transferGroups.has(edit.transferGroupId)) {
            transferGroups.set(edit.transferGroupId, []);
          }
          transferGroups.get(edit.transferGroupId)!.push(entry);
        } else {
          nonTransferEntries.push(entry);
        }
      }

      // Complete pair = exactly 2 legs with the same transferGroupId.
      // Incomplete legs fall through to PATCH like standalone edits.
      type TransferPair = {
        src: [BudgetCellKey, StagedBudgetEdit];
        dst: [BudgetCellKey, StagedBudgetEdit];
      };
      const completePairs: TransferPair[] = [];
      const incompleteLegs: [BudgetCellKey, StagedBudgetEdit][] = [];

      for (const legs of transferGroups.values()) {
        if (legs.length === 2) {
          const [a, b] = legs as [[BudgetCellKey, StagedBudgetEdit], [BudgetCellKey, StagedBudgetEdit]];
          const aDelta = a[1].nextBudgeted - a[1].previousBudgeted;
          // src = negative-delta leg (budget decreases), dst = positive-delta leg
          const [src, dst] = aDelta < 0 ? [a, b] : [b, a];
          completePairs.push({ src, dst });
        } else {
          for (const leg of legs) incompleteLegs.push(leg);
        }
      }

      const totalCalls =
        holdEntries.filter(([m]) => availableSet.has(m)).length +
        completePairs.length +
        incompleteLegs.length +
        nonTransferEntries.length;

      setIsSaving(true);
      setProgress({ completed: 0, total: totalCalls });

      const succeededKeys: BudgetCellKey[] = [];
      const succeededHoldMonths: string[] = [];
      const successMonths = new Set<string>();
      let completedCalls = 0;

      await transport.batchBudgetUpdates(async () => {
        // ── 0. Staged holds ─────────────────────────────────────────────────────
        for (const [month, hold] of holdEntries) {
          if (!availableSet.has(month)) {
            results.push({
              month,
              categoryId: "",
              status: "error",
              message: `Month ${month} is no longer available in this budget`,
            });
            continue;
          }

          try {
            if (hold.nextAmount === 0) {
              await transport.resetBudgetHold(month);
            } else {
              // When the server already has a hold (previousAmount > 0), DELETE it
              // first so the subsequent POST sets an absolute value rather than
              // adding on top of whatever the server currently holds.
              if (hold.previousAmount > 0) {
                await transport.resetBudgetHold(month);
              }
              await transport.holdBudgetForNextMonth(month, hold.nextAmount);
            }

            // Optimistic cache update: apply the hold to the cached month state.
            queryClient.setQueryData(
              ["budget-month-data", connection.id, month],
              (prev: LoadedMonthState | undefined) => {
                if (!prev) return prev;
                const holdDelta = hold.nextAmount - prev.summary.forNextMonth;
                return {
                  ...prev,
                  summary: {
                    ...prev.summary,
                    forNextMonth: hold.nextAmount,
                    toBudget: prev.summary.toBudget - holdDelta,
                  },
                };
              }
            );

            succeededHoldMonths.push(month);
            successMonths.add(month);
            results.push({ month, categoryId: "", status: "success" });
          } catch (err) {
            const message =
              err instanceof Error
                ? err.message
                : (err as { message?: string }).message ?? "Save failed";
            setHoldSaveError(month, message);
            results.push({ month, categoryId: "", status: "error", message });
          }

          completedCalls++;
          setProgress({ completed: completedCalls, total: totalCalls });
        }

        // ── 1. Complete transfer pairs via atomic transfer ─────────────────────
        for (const { src, dst } of completePairs) {
          const [srcKey, srcEdit] = src;
          const [dstKey, dstEdit] = dst;
          const amount = dstEdit.nextBudgeted - dstEdit.previousBudgeted;
          const month = srcEdit.month;

          try {
            await transport.transferBudget(month, {
              fromCategoryId: srcEdit.categoryId,
              toCategoryId: dstEdit.categoryId,
              amount,
            });

            // BM-11: Optimistic cache update for both legs together.
            queryClient.setQueryData(
              ["budget-month-data", connection.id, month],
              (prev: LoadedMonthState | undefined) => {
                if (!prev) return prev;
                let next = applyBudgetedToMonthState(prev, srcEdit.categoryId, srcEdit.nextBudgeted, isTracking);
                next = applyBudgetedToMonthState(next, dstEdit.categoryId, dstEdit.nextBudgeted, isTracking);
                return next;
              }
            );

            succeededKeys.push(srcKey, dstKey);
            successMonths.add(month);
            results.push(
              { month, categoryId: srcEdit.categoryId, status: "success" },
              { month, categoryId: dstEdit.categoryId, status: "success" }
            );
          } catch (err) {
            const message =
              err instanceof Error
                ? err.message
                : (err as { message?: string }).message ?? "Save failed";
            setSaveError(srcKey, message);
            setSaveError(dstKey, message);
            results.push(
              { month, categoryId: srcEdit.categoryId, status: "error", message },
              { month, categoryId: dstEdit.categoryId, status: "error", message }
            );
          }

          completedCalls++;
          setProgress({ completed: completedCalls, total: totalCalls });
        }

        // ── 2. Incomplete transfer legs + standalone edits ───────────────────
        const patchEntries = [...incompleteLegs, ...nonTransferEntries];

        for (const [key, edit] of patchEntries) {
          try {
            await transport.setBudgetAmount(edit.month, edit.categoryId, edit.nextBudgeted);

            // BM-11: Optimistically update the cached month state so the grid
            // clears the amber "staged" styling immediately, without waiting for
            // the invalidation refetch round trip.
            queryClient.setQueryData(
              ["budget-month-data", connection.id, edit.month],
              (prev: LoadedMonthState | undefined) =>
                prev ? applyBudgetedToMonthState(prev, edit.categoryId, edit.nextBudgeted, isTracking) : prev
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
              err instanceof Error
                ? err.message
                : (err as { message?: string }).message ?? "Save failed";
            setSaveError(key, message);
            results.push({
              month: edit.month,
              categoryId: edit.categoryId,
              status: "error",
              message,
            });
          }

          completedCalls++;
          setProgress({ completed: completedCalls, total: totalCalls });
        }
      });

      // Direct budget batches schedule their own Actual sync after the batch
      // message flush. Forcing an immediate sync here can race that flush and
      // pull the old remote budget state back over the just-written values.

      // Clear succeeded hold months from the store.
      if (succeededHoldMonths.length > 0) {
        clearHoldsForMonths(succeededHoldMonths);
      }

      // Clear only the edit keys that actually succeeded AND whose stored value
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
      }

      // Clear undo/redo history after any successful save so the user cannot
      // undo back to a state that has already been persisted to the server.
      if (succeededKeys.length > 0 || succeededHoldMonths.length > 0) {
        clearHistory();
      }

      // Invalidate in parallel — invalidations are read-side and independent.
      // The optimistic updates above already cleared the UI; these refetches
      // reconcile against the server.
      if (successMonths.size > 0) {
        // BM-10: a saved edit cascades forward only (carryover, envelope
        // balances, incomeAvailable/toBudget of later months). Invalidate EVERY
        // cached budget-month-data query for this connection at or after the
        // earliest changed month — not just the current window — so a
        // previously-visited later month that is still cached can't stay stale.
        // Earlier months cannot be affected, so they are left cached.
        const earliestSuccess = Array.from(successMonths).sort()[0]!;
        await queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey;
            return (
              Array.isArray(key) &&
              key[0] === "budget-month-data" &&
              key[1] === connection.id &&
              typeof key[2] === "string" &&
              key[2] >= earliestSuccess
            );
          },
        });

        // BM-11: Tracking income budgeted values come from a separate
        // reflect_budgets query (useIncomeBudgets). Its cache is not touched by
        // the month-data invalidation above, so a just-saved income edit could
        // be overwritten by its stale fallback on the next effective-state pass.
        // Refresh that key too. (Envelope never runs this query, so gate on it.)
        if (isTracking) {
          await queryClient.invalidateQueries({
            queryKey: ["income-budgets", connection.id],
          });
        }
      }

      setIsSaving(false);
      setProgress({ completed: 0, total: 0 });

      return results;
    },
    [connection, queryClient, clearEditsForKeys, clearHoldsForMonths, clearHistory, setSaveError, setHoldSaveError]
  );

  return { save, isSaving, progress };
}
