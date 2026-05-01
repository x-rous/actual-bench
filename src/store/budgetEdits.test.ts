import { useBudgetEditsStore } from "./budgetEdits";
import type {
  BudgetCellKey,
  StagedBudgetEdit,
} from "@/features/budget-management/types";

function reset() {
  useBudgetEditsStore.setState({
    edits: {},
    undoStack: [],
    redoStack: [],
    uiSelection: { month: null, categoryId: null, groupId: null },
    displayMonths: [],
  });
}

beforeEach(reset);

function edit(
  month: string,
  categoryId: string,
  next: number,
  prev: number
): StagedBudgetEdit {
  return { month, categoryId, nextBudgeted: next, previousBudgeted: prev, source: "manual" };
}

function key(month: string, cat: string): BudgetCellKey {
  return `${month}:${cat}`;
}

describe("budgetEdits store — patch-based undo/redo (BM-19)", () => {
  describe("stageEdit", () => {
    it("adds a new key and undo removes it cleanly", () => {
      const s = useBudgetEditsStore.getState();
      s.stageEdit(edit("2026-01", "c1", 1500, 1000));
      expect(useBudgetEditsStore.getState().edits[key("2026-01", "c1")]).toBeDefined();

      useBudgetEditsStore.getState().undo();
      expect(useBudgetEditsStore.getState().edits[key("2026-01", "c1")]).toBeUndefined();
    });

    it("restores the prior edit when overwriting", () => {
      const original = edit("2026-01", "c1", 1500, 1000);
      const overwrite = edit("2026-01", "c1", 9000, 1000);
      useBudgetEditsStore.getState().stageEdit(original);
      useBudgetEditsStore.getState().stageEdit(overwrite);

      // Confirm the overwrite is in place.
      expect(useBudgetEditsStore.getState().edits[key("2026-01", "c1")]?.nextBudgeted).toBe(9000);

      useBudgetEditsStore.getState().undo();
      // After undo, the prior edit (`original`) is restored — not deleted.
      expect(useBudgetEditsStore.getState().edits[key("2026-01", "c1")]?.nextBudgeted).toBe(1500);
    });

    it("does not push a duplicate undo step for an identical edit", () => {
      const e = edit("2026-01", "c1", 1500, 1000);
      useBudgetEditsStore.getState().stageEdit(e);
      useBudgetEditsStore.getState().stageEdit(e);

      expect(useBudgetEditsStore.getState().undoStack).toHaveLength(1);

      useBudgetEditsStore.getState().undo();
      expect(useBudgetEditsStore.getState().edits[key("2026-01", "c1")]).toBeUndefined();
    });

    it("redo replays a previously undone edit", () => {
      const e = edit("2026-01", "c1", 1500, 1000);
      useBudgetEditsStore.getState().stageEdit(e);
      useBudgetEditsStore.getState().undo();
      useBudgetEditsStore.getState().redo();
      expect(useBudgetEditsStore.getState().edits[key("2026-01", "c1")]?.nextBudgeted).toBe(1500);
    });

    it("a new edit clears the redo stack", () => {
      useBudgetEditsStore.getState().stageEdit(edit("2026-01", "c1", 1, 0));
      useBudgetEditsStore.getState().undo();
      expect(useBudgetEditsStore.getState().redoStack.length).toBe(1);

      useBudgetEditsStore.getState().stageEdit(edit("2026-02", "c2", 2, 0));
      expect(useBudgetEditsStore.getState().redoStack.length).toBe(0);
    });
  });

  describe("stageBulkEdits", () => {
    it("applies multiple edits as one undo step", () => {
      useBudgetEditsStore.getState().stageBulkEdits([
        edit("2026-01", "c1", 100, 0),
        edit("2026-02", "c2", 200, 0),
        edit("2026-03", "c3", 300, 0),
      ]);

      expect(Object.keys(useBudgetEditsStore.getState().edits)).toHaveLength(3);
      expect(useBudgetEditsStore.getState().undoStack).toHaveLength(1);

      // Single undo wipes the whole bulk.
      useBudgetEditsStore.getState().undo();
      expect(Object.keys(useBudgetEditsStore.getState().edits)).toHaveLength(0);

      // Single redo restores it.
      useBudgetEditsStore.getState().redo();
      expect(Object.keys(useBudgetEditsStore.getState().edits)).toHaveLength(3);
    });

    it("restores prior edits that the bulk overwrote", () => {
      useBudgetEditsStore.getState().stageEdit(edit("2026-01", "c1", 500, 0));
      useBudgetEditsStore.getState().stageBulkEdits([
        edit("2026-01", "c1", 9999, 0), // overwrite
        edit("2026-02", "c2", 200, 0),  // new
      ]);

      useBudgetEditsStore.getState().undo();
      // c1 reverts to its prior staged value, not deleted.
      expect(useBudgetEditsStore.getState().edits[key("2026-01", "c1")]?.nextBudgeted).toBe(500);
      // c2 was new, so it goes away.
      expect(useBudgetEditsStore.getState().edits[key("2026-02", "c2")]).toBeUndefined();
    });

    it("ignores empty bulk arrays without polluting the undo stack", () => {
      useBudgetEditsStore.getState().stageBulkEdits([]);
      expect(useBudgetEditsStore.getState().undoStack).toHaveLength(0);
    });

    it("ignores bulk edits that do not change the staged state", () => {
      const first = edit("2026-01", "c1", 100, 0);
      const second = edit("2026-02", "c2", 200, 0);
      useBudgetEditsStore.getState().stageBulkEdits([first, second]);
      useBudgetEditsStore.getState().stageBulkEdits([first, second]);

      expect(useBudgetEditsStore.getState().undoStack).toHaveLength(1);

      useBudgetEditsStore.getState().undo();
      expect(Object.keys(useBudgetEditsStore.getState().edits)).toHaveLength(0);
    });
  });

  describe("removeEdit", () => {
    it("undo restores the removed edit", () => {
      const e = edit("2026-01", "c1", 1500, 1000);
      useBudgetEditsStore.getState().stageEdit(e);
      useBudgetEditsStore.getState().removeEdit(key("2026-01", "c1"));
      expect(useBudgetEditsStore.getState().edits[key("2026-01", "c1")]).toBeUndefined();

      useBudgetEditsStore.getState().undo();
      expect(useBudgetEditsStore.getState().edits[key("2026-01", "c1")]).toEqual(e);
    });

    it("is a no-op when the key is absent", () => {
      useBudgetEditsStore.getState().removeEdit(key("2026-01", "missing"));
      expect(useBudgetEditsStore.getState().undoStack).toHaveLength(0);
    });
  });

  describe("clearEditsForKeys / clearEditsForMonths", () => {
    it("does NOT push an undo entry (save-side cleanup)", () => {
      useBudgetEditsStore.getState().stageBulkEdits([
        edit("2026-01", "c1", 100, 0),
        edit("2026-02", "c2", 200, 0),
      ]);
      const beforeUndoLen = useBudgetEditsStore.getState().undoStack.length;

      useBudgetEditsStore.getState().clearEditsForKeys([key("2026-01", "c1")]);
      expect(useBudgetEditsStore.getState().undoStack.length).toBe(beforeUndoLen);
      expect(useBudgetEditsStore.getState().edits[key("2026-01", "c1")]).toBeUndefined();
      expect(useBudgetEditsStore.getState().edits[key("2026-02", "c2")]).toBeDefined();
    });
  });

  describe("undo depth bound", () => {
    it("respects MAX_UNDO_DEPTH = 50 by dropping the oldest patch", () => {
      for (let i = 0; i < 60; i++) {
        useBudgetEditsStore.getState().stageEdit(edit("2026-01", `c${i}`, i, 0));
      }
      expect(useBudgetEditsStore.getState().undoStack.length).toBe(50);
    });
  });
});
