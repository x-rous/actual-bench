"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { getTransport } from "@/lib/actual";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { budgetMonthDataQueryOptions } from "./useMonthData";
import { formatMinor } from "../lib/format";
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
  // An income category contributes to none of the expense summary aggregates
  // (`totalBudgeted`/`totalBalance` are what the grid renders as "Total Budgeted
  // Expenses"/"Total Expense Balance", and `toBudget` is what an allocation
  // consumes). This must match effectiveMonth's Layer 2 rule exactly, or the
  // grid jumps when the save swaps the staged overlay for the saved value -
  // which is the whole contract this reducer exists to keep (BM-12).
  const skipSummaryUpdate = cat.isIncome || (isTracking && effectivelyHidden);

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
 *   0. Staged holds → outside the budget batch, from a fresh read of the
 *      current hold, each read back to report a hold Actual capped
 *   1. Pure transfer pairs (each leg changes by exactly the transfer against
 *      the server value) → POST /months/{month}/categorytransfers (atomic)
 *   2. Every other leg + standalone edits → PATCH per cell (absolute value)
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

      // Pre-save guard: verify each edit's category exists in the month it is
      // saved to (read from the TanStack Query cache the workspace has already
      // warmed, or fetched). A category created part-way through the window is
      // absent from earlier months, so each target month is checked on its own.
      const categoryIdsByMonth = new Map<string, Set<string>>();
      const targetMonths = [...new Set(monthValidEntries.map(([, edit]) => edit.month))];
      const probed = await Promise.allSettled(
        targetMonths.map(async (month) => {
          const monthState = await queryClient.fetchQuery(budgetMonthDataQueryOptions(connection, month));
          return [month, new Set(Object.keys(monthState.categoriesById))] as const;
        })
      );
      // A month that cannot be loaded is not checked: per-PATCH errors then
      // surface deleted-category failures with the server's own message.
      for (const outcome of probed) {
        if (outcome.status === "fulfilled") categoryIdsByMonth.set(outcome.value[0], outcome.value[1]);
      }

      const validEntries: [BudgetCellKey, StagedBudgetEdit][] = [];
      for (const entry of monthValidEntries) {
        const [key, edit] = entry;
        const validCategoryIds = categoryIdsByMonth.get(edit.month);
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

      // A transfer is relative: Actual moves `amount` from the server's current
      // values. That only lands on the staged values when each leg's change
      // against the server is exactly the transfer and nothing else - not when
      // a hand edit was staged in the same cell first, or the cell was in an
      // earlier transfer (C1). Anything else is written as absolute values.
      const cachedServerBudgeted = (month: string, categoryId: string) =>
        queryClient.getQueryData<LoadedMonthState>([
          "budget-month-data",
          connection.id,
          month,
        ])?.categoriesById[categoryId]?.budgeted;

      // The cache can be stale (another client may have changed a leg), so a
      // relative move is only trusted against values read from the server just
      // now. A month that cannot be read leaves its pairs as absolute writes.
      const pairMonths = new Set<string>();
      for (const legs of transferGroups.values()) {
        if (legs.length === 2 && legs[0][1].month === legs[1][1].month) pairMonths.add(legs[0][1].month);
      }
      const freshPairBudgeted = new Map<string, number>();
      const freshPairs = await Promise.allSettled(
        [...pairMonths].map((month) =>
          queryClient.fetchQuery({ ...budgetMonthDataQueryOptions(connection, month), staleTime: 0 })
            .then((state) => [month, state] as const)
        )
      );
      for (const outcome of freshPairs) {
        if (outcome.status !== "fulfilled") continue;
        const [month, state] = outcome.value;
        for (const [categoryId, cat] of Object.entries(state.categoriesById)) {
          freshPairBudgeted.set(`${month}:${categoryId}`, cat.budgeted);
        }
      }
      const freshServerBudgeted = (month: string, categoryId: string) =>
        freshPairBudgeted.get(`${month}:${categoryId}`);

      for (const legs of transferGroups.values()) {
        if (legs.length === 2) {
          const [a, b] = legs as [[BudgetCellKey, StagedBudgetEdit], [BudgetCellKey, StagedBudgetEdit]];
          const aDelta = a[1].nextBudgeted - a[1].previousBudgeted;
          const bDelta = b[1].nextBudgeted - b[1].previousBudgeted;
          const isPureTransfer =
            a[1].month === b[1].month &&
            aDelta !== 0 &&
            aDelta === -bDelta &&
            freshServerBudgeted(a[1].month, a[1].categoryId) === a[1].previousBudgeted &&
            freshServerBudgeted(b[1].month, b[1].categoryId) === b[1].previousBudgeted;
          if (!isPureTransfer) {
            incompleteLegs.push(a, b);
            continue;
          }
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

      // M4: never leave the progress dialog stuck in "saving".
      try {
        // ── 0. Staged holds - outside the budget batch (C2) ─────────────────
        // Actual's hold is additive (buffered = old + amount, capped at To
        // Budget) and reads `buffered` when it runs. Inside a Direct batch every
        // write is deferred until the batch ends, so a reset followed by a hold
        // would still see the old hold and add to it. Each hold therefore runs
        // on its own, from a fresh read of the month's current hold:
        //   - raising it holds only the difference (capped by the live To Budget)
        //   - lowering or freeing it resets, then holds the new amount
        // so the result is absolute even if the hold changed elsewhere.
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

          const readFresh = () =>
            queryClient.fetchQuery({
              ...budgetMonthDataQueryOptions(connection, month),
              staleTime: 0,
            });

          const holdError = (message: string, serverAmount?: number) => {
            // The hold stays staged with its error, so Retry Failed can read the
            // live hold again and apply only what is still missing. When the
            // live hold is known it becomes the draft's baseline: after a short
            // hold, Free must still clear what Actual did hold.
            setHoldSaveError(month, message, serverAmount);
            results.push({ month, categoryId: "", status: "error", message });
          };

          try {
            const currentHold = (await readFresh()).summary.forNextMonth;
            if (hold.nextAmount > currentHold) {
              await transport.holdBudgetForNextMonth(month, hold.nextAmount - currentHold);
              successMonths.add(month);
            } else if (hold.nextAmount < currentHold) {
              await transport.resetBudgetHold(month);
              // The reset changed the month even if the new hold below fails,
              // so the month (and later ones) must be refreshed either way.
              successMonths.add(month);
              if (hold.nextAmount > 0) {
                await transport.holdBudgetForNextMonth(month, hold.nextAmount);
              }
            }

            // H5: Actual holds at most To Budget, and nothing at all when To
            // Budget is 0 or less, without raising an error. Read the month back
            // (this also refreshes the cache) and report a short hold.
            let heldAmount: number | null = null;
            try {
              heldAmount = (await readFresh()).summary.forNextMonth;
            } catch {
              // Handled below: an unverified hold is not reported as saved.
            }

            if (heldAmount === null) {
              holdError("The hold was sent but could not be checked. Retry to check it again.");
            } else if (heldAmount !== hold.nextAmount) {
              holdError(
                heldAmount === 0
                  ? "Actual held nothing for next month: To Budget had no money left when the hold was saved."
                  : `Actual held ${formatMinor(heldAmount)} instead of ${formatMinor(hold.nextAmount)}: a hold cannot be more than To Budget.`,
                heldAmount
              );
            } else {
              succeededHoldMonths.push(month);
              results.push({ month, categoryId: "", status: "success" });
            }
          } catch (err) {
            const message =
              err instanceof Error
                ? err.message
                : (err as { message?: string }).message ?? "Save failed";
            // A reset may have gone through before the failure; learn the
            // live hold if we can, so the draft's baseline stays true.
            let serverAmount: number | undefined;
            try {
              serverAmount = (await readFresh()).summary.forNextMonth;
            } catch {
              // Unknown: keep the baseline the draft already has.
            }
            holdError(message, serverAmount);
          }

          completedCalls++;
          setProgress({ completed: completedCalls, total: totalCalls });
        }

        // Holds are committed by now: clear them from the store before the
        // budget batch, so a batch that rejects cannot leave them staged.
        if (succeededHoldMonths.length > 0) {
          clearHoldsForMonths(succeededHoldMonths);
        }

        const hasCellWrites =
          completePairs.length + incompleteLegs.length + nonTransferEntries.length > 0;
        let batchError: unknown = null;
        if (hasCellWrites) {
          try {
            await transport.batchBudgetUpdates(async () => {
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

              // F-146: nothing upstream drops a no-op. `sameEdit` in the edits store
              // compares a staged edit against another *staged* edit, never against
              // the server, so "copy previous month" on a stable budget stages cells
              // whose value is already correct - one serialized round trip each.
              //
              // Skipping those is only safe against data the server actually holds
              // now. The cached month state can be arbitrarily stale: `staleTime` is
              // Infinity and refetch-on-focus is deliberately off, so another client's
              // write is invisible here. Skipping on a stale cache would clear the
              // staged edit while leaving the server on the old value - a silent loss.
              //
              // So: use the cache only to find *candidates*, then verify those months
              // for real. When nothing looks skippable this costs no requests at all,
              // which is the common case for hand-typed edits; when a bulk copy makes
              // dozens skippable it spends a handful of reads to avoid dozens of
              // writes. A month that will not refetch simply yields no skips.
              const candidateMonths = new Set(
                patchEntries
                  .filter(([, edit]) => cachedServerBudgeted(edit.month, edit.categoryId) === edit.nextBudgeted)
                  .map(([, edit]) => edit.month)
              );

              const verifiedBudgeted = new Map<string, number>();
              if (candidateMonths.size > 0) {
                const verified = await Promise.allSettled(
                  [...candidateMonths].map(async (month) => {
                    const fresh = await queryClient.fetchQuery({
                      ...budgetMonthDataQueryOptions(connection, month),
                      staleTime: 0,
                    });
                    return [month, fresh] as const;
                  })
                );
                for (const outcome of verified) {
                  if (outcome.status !== "fulfilled") continue;
                  const [month, state] = outcome.value;
                  for (const [categoryId, cat] of Object.entries(state.categoriesById)) {
                    verifiedBudgeted.set(`${month}:${categoryId}`, cat.budgeted);
                  }
                }
              }

              for (const [key, edit] of patchEntries) {
                try {
                  // Only a value confirmed against a fresh read is allowed to cancel
                  // a write; anything unverified falls through and is written.
                  const serverValue = verifiedBudgeted.get(`${edit.month}:${edit.categoryId}`);

                  if (serverValue !== undefined && serverValue === edit.nextBudgeted) {
                    // Cleared from the staged edits and reported saved, but
                    // deliberately NOT added to successMonths: nothing changed on the
                    // server, so this cell must not drag the forward invalidation
                    // (and its refetch of every later month) along with it.
                    succeededKeys.push(key);
                    results.push({
                      month: edit.month,
                      categoryId: edit.categoryId,
                      status: "success",
                    });
                    completedCalls++;
                    setProgress({ completed: completedCalls, total: totalCalls });
                    continue;
                  }

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
          } catch (err) {
            // The cell edits stay staged and the caller reports the rejection;
            // the holds above are already reconciled, and the refresh below
            // still runs for every month that changed.
            batchError = err;
            succeededKeys.length = 0;
          }
        }

        // Direct budget batches schedule their own Actual sync after the batch
        // message flush. Forcing an immediate sync here can race that flush and
        // pull the old remote budget state back over the just-written values.

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

        if (batchError !== null) throw batchError;
      } finally {
        setIsSaving(false);
        setProgress({ completed: 0, total: 0 });
      }

      return results;
    },
    [connection, queryClient, clearEditsForKeys, clearHoldsForMonths, clearHistory, setSaveError, setHoldSaveError]
  );

  return { save, isSaving, progress };
}
