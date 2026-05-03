"use client";

import { create } from "zustand";
import type {
  BudgetCellKey,
  BudgetEditsActions,
  BudgetEditsState,
  StagedBudgetEdit,
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
 *   { key, prev: undefined } — key did not exist before; undo deletes it
 *   { key, prev: <edit> }    — key existed; undo restores `prev`
 *
 * Each patch holds at most O(changed-keys) state. For a single-cell edit,
 * one patch entry. For a bulk paste/import, one entry per cell — but only
 * for the cells the operation actually touched.
 *
 * `undo()` applies the patch in reverse to recover the prior `edits` state,
 * while pushing the inverse onto `redoStack`. `redo()` is symmetric.
 */
type EditPatch = {
  key: BudgetCellKey;
  prev: StagedBudgetEdit | undefined;
};

function applyPatches(
  edits: Record<BudgetCellKey, StagedBudgetEdit>,
  patches: EditPatch[]
): {
  next: Record<BudgetCellKey, StagedBudgetEdit>;
  inverse: EditPatch[];
} {
  const next: Record<BudgetCellKey, StagedBudgetEdit> = { ...edits };
  const inverse: EditPatch[] = [];
  // Apply newest-first so the inverse runs back to original order.
  for (let i = patches.length - 1; i >= 0; i--) {
    const p = patches[i]!;
    inverse.push({ key: p.key, prev: edits[p.key] });
    if (p.prev === undefined) {
      delete next[p.key];
    } else {
      next[p.key] = p.prev;
    }
  }
  // Inverse was built newest-first; reverse so callers can apply it directly.
  inverse.reverse();
  return { next, inverse };
}

/**
 * Build a patch list capturing the prior values of every key that's about to
 * be added or replaced. Keys absent from `edits` get `prev: undefined`.
 */
function buildPatchForChanges(
  edits: Record<BudgetCellKey, StagedBudgetEdit>,
  keysAffected: Iterable<BudgetCellKey>
): EditPatch[] {
  const seen = new Set<BudgetCellKey>();
  const patches: EditPatch[] = [];
  for (const key of keysAffected) {
    if (seen.has(key)) continue;
    seen.add(key);
    patches.push({ key, prev: edits[key] });
  }
  return patches;
}

// ─── Store ────────────────────────────────────────────────────────────────────

type BudgetEditsStore = BudgetEditsState & BudgetEditsActions;

const MAX_UNDO_DEPTH = 50;

function pushPatch(stack: EditPatch[][], patch: EditPatch[]): EditPatch[][] {
  if (patch.length === 0) return stack;
  return [...stack, patch].slice(-MAX_UNDO_DEPTH);
}

export const useBudgetEditsStore = create<BudgetEditsStore>()((set, get) => ({
  edits: {},
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
    const patch = buildPatchForChanges(edits, [key]);
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
    for (const edit of newEdits) {
      const key = makeKey(edit);
      keys.add(key);
      next[key] = edit;
    }
    const changedKeys = [...keys].filter((key) => !sameEdit(edits[key], next[key]));
    if (changedKeys.length === 0) return;
    const patch = buildPatchForChanges(edits, changedKeys);
    set({
      undoStack: pushPatch(undoStack, patch),
      redoStack: [],
      edits: next,
    });
  },

  removeEdit(key) {
    const { edits, undoStack } = get();
    if (!(key in edits)) return;
    const patch = buildPatchForChanges(edits, [key]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [key]: _removed, ...rest } = edits;
    set({
      undoStack: pushPatch(undoStack, patch),
      redoStack: [],
      edits: rest as Record<BudgetCellKey, StagedBudgetEdit>,
    });
  },

  discardAll() {
    set({ edits: {}, undoStack: [], redoStack: [] });
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
    const { edits, undoStack, redoStack } = get();
    if (undoStack.length === 0) return;
    const patch = undoStack[undoStack.length - 1]!;
    const { next, inverse } = applyPatches(edits, patch);
    set({
      edits: next,
      undoStack: undoStack.slice(0, -1),
      redoStack: pushPatch(redoStack, inverse),
    });
  },

  redo() {
    const { edits, undoStack, redoStack } = get();
    if (redoStack.length === 0) return;
    const patch = redoStack[redoStack.length - 1]!;
    const { next, inverse } = applyPatches(edits, patch);
    set({
      edits: next,
      undoStack: pushPatch(undoStack, inverse),
      redoStack: redoStack.slice(0, -1),
    });
  },

  hasPendingEdits() {
    return Object.keys(get().edits).length > 0;
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
