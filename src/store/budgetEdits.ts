"use client";

import { create } from "zustand";
import type {
  ActionPatch,
  BudgetCellKey,
  BudgetEditsActions,
  BudgetEditsState,
  StagedBudgetEdit,
  StagedHold,
} from "@/features/budget-management/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeKey(edit: StagedBudgetEdit): BudgetCellKey {
  return `${edit.month}:${edit.categoryId}`;
}

function sameEdit(
  a: StagedBudgetEdit | undefined,
  b: StagedBudgetEdit | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.month === b.month &&
    a.categoryId === b.categoryId &&
    a.nextBudgeted === b.nextBudgeted &&
    a.previousBudgeted === b.previousBudgeted &&
    a.source === b.source
  );
}

/**
 * BM-19: Inverse-patch model for undo/redo.
 *
 * Pre-BM-19, every action snapshotted the full edits map (~O(N) per action,
 * O(N × actions) total memory). With 50 staged edits and 50 undo entries,
 * that's 2,500 redundant edit objects retained.
 *
 * A patch records exactly what changed:
 *   { type: "edit", key, prev: undefined } — key did not exist; undo deletes it
 *   { type: "edit", key, prev: <edit> }    — key existed; undo restores `prev`
 *   { type: "hold", month, prev: undefined } — no hold existed; undo deletes it
 *   { type: "hold", month, prev: <hold> }    — hold existed; undo restores `prev`
 *
 * `undo()` applies the patch in reverse to recover the prior state, while
 * pushing the inverse onto `redoStack`. `redo()` is symmetric.
 */

function applyActionPatches(
  edits: Record<BudgetCellKey, StagedBudgetEdit>,
  holds: Record<string, StagedHold>,
  patches: ActionPatch[]
): {
  nextEdits: Record<BudgetCellKey, StagedBudgetEdit>;
  nextHolds: Record<string, StagedHold>;
  inverse: ActionPatch[];
} {
  const nextEdits: Record<BudgetCellKey, StagedBudgetEdit> = { ...edits };
  const nextHolds: Record<string, StagedHold> = { ...holds };
  const inverse: ActionPatch[] = [];
  // Apply newest-first so the inverse runs back to original order.
  for (let i = patches.length - 1; i >= 0; i--) {
    const p = patches[i]!;
    if (p.type === "edit") {
      inverse.push({ type: "edit", key: p.key, prev: edits[p.key] });
      if (p.prev === undefined) delete nextEdits[p.key];
      else nextEdits[p.key] = p.prev;
    } else {
      inverse.push({ type: "hold", month: p.month, prev: holds[p.month] });
      if (p.prev === undefined) delete nextHolds[p.month];
      else nextHolds[p.month] = p.prev;
    }
  }
  // Inverse was built newest-first; reverse so callers can apply it directly.
  inverse.reverse();
  return { nextEdits, nextHolds, inverse };
}

/**
 * Build a patch list capturing the prior values of every edit key that's
 * about to be added or replaced. Keys absent from `edits` get `prev: undefined`.
 */
function buildEditPatchForChanges(
  edits: Record<BudgetCellKey, StagedBudgetEdit>,
  keysAffected: Iterable<BudgetCellKey>
): ActionPatch[] {
  const seen = new Set<BudgetCellKey>();
  const patches: ActionPatch[] = [];
  for (const key of keysAffected) {
    if (seen.has(key)) continue;
    seen.add(key);
    patches.push({ type: "edit", key, prev: edits[key] });
  }
  return patches;
}

// ─── Store ────────────────────────────────────────────────────────────────────

type BudgetEditsStore = BudgetEditsState & BudgetEditsActions;

const MAX_UNDO_DEPTH = 50;

function pushPatch(stack: ActionPatch[][], patch: ActionPatch[]): ActionPatch[][] {
  if (patch.length === 0) return stack;
  return [...stack, patch].slice(-MAX_UNDO_DEPTH);
}

export const useBudgetEditsStore = create<BudgetEditsStore>()((set, get) => ({
  edits: {},
  holds: {},
  undoStack: [],
  redoStack: [],
  uiSelection: { month: null, categoryId: null, groupId: null },
  rowSelection: null,
  displayMonths: [],

  pushUndo() {
    // Compatibility no-op: the store now records patches automatically on
    // every mutation, so callers no longer need to pre-stage an undo entry.
  },

  stageEdit(edit) {
    const { edits, undoStack } = get();
    const key = makeKey(edit);
    const existing = edits[key];
    if (sameEdit(existing, edit)) {
      if (existing?.saveError && edit.saveError == null) {
        // Clearing a stale save error is metadata cleanup, not a user edit.
        // Do not push an undo entry for the same budget value.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { saveError: _saveError, ...rest } = existing;
        set({ edits: { ...edits, [key]: rest as StagedBudgetEdit } });
      }
      return;
    }
    const patch = buildEditPatchForChanges(edits, [key]);
    set({
      undoStack: pushPatch(undoStack, patch),
      redoStack: [],
      edits: { ...edits, [key]: edit },
    });
  },

  stageBulkEdits(newEdits) {
    if (newEdits.length === 0) return;
    const { edits, undoStack } = get();
    const next: Record<BudgetCellKey, StagedBudgetEdit> = { ...edits };
    const keys = new Set<BudgetCellKey>();
    let clearedSaveError = false;
    for (const edit of newEdits) {
      const key = makeKey(edit);
      keys.add(key);
      const existing = edits[key];
      if (sameEdit(existing, edit) && existing?.saveError && edit.saveError == null) {
        // Clearing stale save errors is metadata cleanup, not a user edit.
        // Do not include it in undo/redo patch calculation.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { saveError: _saveError, ...rest } = existing;
        next[key] = rest as StagedBudgetEdit;
        clearedSaveError = true;
      } else {
        next[key] = edit;
      }
    }
    const changedKeys = [...keys].filter((key) => !sameEdit(edits[key], next[key]));
    if (changedKeys.length === 0) {
      if (clearedSaveError) set({ edits: next });
      return;
    }
    const patch = buildEditPatchForChanges(edits, changedKeys);
    set({
      undoStack: pushPatch(undoStack, patch),
      redoStack: [],
      edits: next,
    });
  },

  removeEdit(key) {
    const { edits, undoStack } = get();
    if (!(key in edits)) return;
    const patch = buildEditPatchForChanges(edits, [key]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [key]: _removed, ...rest } = edits;
    set({
      undoStack: pushPatch(undoStack, patch),
      redoStack: [],
      edits: rest as Record<BudgetCellKey, StagedBudgetEdit>,
    });
  },

  stageHold(hold) {
    const { holds, undoStack } = get();
    const existing = holds[hold.month];
    if (existing && existing.nextAmount === hold.nextAmount) return;

    // Always preserve the server-baseline previousAmount from the first staging
    // for this month. When the user stages a FREE then re-opens the Hold dialog,
    // the dialog receives currentForNextMonth=0 (effective after overlay) so it
    // passes previousAmount=0 — but the real server value is in existing.previousAmount.
    // Inheriting it here keeps undo, the draft panel, and the save-pipeline reset
    // guard all anchored to the actual server state.
    const previousAmount =
      existing !== undefined ? existing.previousAmount : hold.previousAmount;
    const normalizedHold: StagedHold = { ...hold, previousAmount };

    // If the staged amount equals the server's hold it is a net no-op — remove
    // the entry so it does not pollute the draft panel or trigger a redundant save.
    if (normalizedHold.nextAmount === previousAmount) {
      if (existing !== undefined) {
        const patch: ActionPatch[] = [{ type: "hold", month: hold.month, prev: existing }];
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [hold.month]: _removed, ...rest } = holds;
        set({
          undoStack: pushPatch(undoStack, patch),
          redoStack: [],
          holds: rest as Record<string, StagedHold>,
        });
      }
      return;
    }

    const patch: ActionPatch[] = [{ type: "hold", month: hold.month, prev: existing }];
    set({
      undoStack: pushPatch(undoStack, patch),
      redoStack: [],
      holds: { ...holds, [hold.month]: normalizedHold },
    });
  },

  removeHold(month) {
    const { holds } = get();
    if (!(month in holds)) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [month]: _removed, ...rest } = holds;
    set({ holds: rest as Record<string, StagedHold> });
  },

  clearHoldsForMonths(months) {
    const { holds } = get();
    const monthSet = new Set(months);
    const next: Record<string, StagedHold> = {};
    for (const [m, hold] of Object.entries(holds)) {
      if (!monthSet.has(m)) next[m] = hold;
    }
    set({ holds: next });
  },

  setHoldSaveError(month, message) {
    const { holds } = get();
    const existing = holds[month];
    if (!existing) return;
    set({ holds: { ...holds, [month]: { ...existing, saveError: message } } });
  },

  clearHoldSaveError(month) {
    const { holds } = get();
    const existing = holds[month];
    if (!existing) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { saveError: _saveError, ...rest } = existing;
    set({ holds: { ...holds, [month]: rest as StagedHold } });
  },

  discardAll() {
    set({ edits: {}, holds: {}, undoStack: [], redoStack: [] });
  },

  clearHistory() {
    set({ undoStack: [], redoStack: [] });
  },

  clearEditsForMonths(months) {
    const { edits } = get();
    const monthSet = new Set(months);
    const next: Record<BudgetCellKey, StagedBudgetEdit> = {};
    for (const [key, edit] of Object.entries(edits)) {
      if (!monthSet.has(edit.month)) {
        next[key as BudgetCellKey] = edit;
      }
    }
    // Save-side cleanup; do not record an undo entry.
    set({ edits: next });
  },

  clearEditsForKeys(keys) {
    const { edits } = get();
    const keySet = new Set(keys);
    const next: Record<BudgetCellKey, StagedBudgetEdit> = {};
    for (const [key, edit] of Object.entries(edits)) {
      if (!keySet.has(key as BudgetCellKey)) {
        next[key as BudgetCellKey] = edit;
      }
    }
    // Save-side cleanup; do not record an undo entry.
    set({ edits: next });
  },

  setSaveError(key, message) {
    const { edits } = get();
    const existing = edits[key];
    if (!existing) return;
    set({ edits: { ...edits, [key]: { ...existing, saveError: message } } });
  },

  clearSaveError(key) {
    const { edits } = get();
    const existing = edits[key];
    if (!existing) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { saveError: _saveError, ...rest } = existing;
    set({ edits: { ...edits, [key]: rest as StagedBudgetEdit } });
  },

  undo() {
    const { edits, holds, undoStack, redoStack } = get();
    if (undoStack.length === 0) return;
    const patch = undoStack[undoStack.length - 1]!;
    const { nextEdits, nextHolds, inverse } = applyActionPatches(edits, holds, patch);
    set({
      edits: nextEdits,
      holds: nextHolds,
      undoStack: undoStack.slice(0, -1),
      redoStack: pushPatch(redoStack, inverse),
    });
  },

  redo() {
    const { edits, holds, undoStack, redoStack } = get();
    if (redoStack.length === 0) return;
    const patch = redoStack[redoStack.length - 1]!;
    const { nextEdits, nextHolds, inverse } = applyActionPatches(edits, holds, patch);
    set({
      edits: nextEdits,
      holds: nextHolds,
      undoStack: pushPatch(undoStack, inverse),
      redoStack: redoStack.slice(0, -1),
    });
  },

  hasPendingEdits() {
    const { edits, holds } = get();
    return Object.keys(edits).length > 0 || Object.keys(holds).length > 0;
  },

  setUiSelection(month, categoryId, groupId = null) {
    set({
      uiSelection: { month, categoryId, groupId },
      // Cell/group-cell selection is mutually exclusive with row selection.
      rowSelection: null,
    });
  },

  setRowSelection(selection) {
    set({
      rowSelection: selection,
      // Clear cell/group-cell selection so the draft panel routes correctly.
      uiSelection: { month: null, categoryId: null, groupId: null },
    });
  },

  setDisplayMonths(months) {
    set({ displayMonths: months });
  },
}));
