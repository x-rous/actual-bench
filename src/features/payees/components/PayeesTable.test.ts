/** @jest-environment jsdom */

import {
  gapBefore,
  shouldHandlePayeeGridPaste,
  withEditingRow,
} from "./PayeesTable";

describe("shouldHandlePayeeGridPaste", () => {
  it("leaves paste in the search input instead of treating it as a payee edit", () => {
    const search = document.createElement("input");

    expect(shouldHandlePayeeGridPaste(search, false)).toBe(false);
  });

  it("handles spreadsheet paste when focus is on the grid", () => {
    const grid = document.createElement("div");

    expect(shouldHandlePayeeGridPaste(grid, false)).toBe(true);
  });

  it("leaves paste in the active cell editor", () => {
    const grid = document.createElement("div");

    expect(shouldHandlePayeeGridPaste(grid, true)).toBe(false);
  });
});

/*
 * The payees table renders only the rows in view. The row being edited is the
 * exception, and it has to be: `EditableCellInput` is uncontrolled and commits
 * what was typed when it loses focus, and React does not fire blur when it
 * unmounts a focused element. A row scrolled out of the window mid-edit would
 * therefore take the new name with it - no message, no trace.
 *
 * The rendering itself has no coverage and cannot have any: jsdom reports every
 * element as zero-sized, so the window comes back empty whether the code works
 * or not. This is the part that can be stated as a rule, and it is the part
 * that loses data when it is wrong.
 */
describe("withEditingRow", () => {
  it("leaves the window alone when nothing is being edited", () => {
    const visible = [10, 11, 12];
    expect(withEditingRow(visible, null)).toBe(visible);
  });

  it("leaves the window alone when the edited row is already in it", () => {
    const visible = [10, 11, 12];
    expect(withEditingRow(visible, 11)).toBe(visible);
  });

  it("keeps an edited row that has scrolled above the window", () => {
    expect(withEditingRow([10, 11, 12], 3)).toEqual([3, 10, 11, 12]);
  });

  it("keeps an edited row that has scrolled below the window", () => {
    expect(withEditingRow([10, 11, 12], 40)).toEqual([10, 11, 12, 40]);
  });

  it("returns the indices in order, so no row is placed in the wrong slot", () => {
    const result = withEditingRow([10, 11, 12], 5);
    expect(result).toEqual([...result].sort((a, b) => a - b));
  });

  it("handles an edit while the window is empty", () => {
    expect(withEditingRow([], 7)).toEqual([7]);
  });

  it("keeps the first row of the list when the user has scrolled far past it", () => {
    expect(withEditingRow([500, 501], 0)).toEqual([0, 500, 501]);
  });
});

describe("gapBefore", () => {
  it("is nothing for the first rendered row", () => {
    expect(gapBefore(undefined, { start: 14_500 })).toBe(0);
  });

  it("is nothing between rows that sit next to each other", () => {
    expect(gapBefore({ end: 145 }, { start: 145 })).toBe(0);
  });

  it("spans the rows left out between an edited row and the window", () => {
    // Row 3 kept mounted while the user scrolled to row 500: everything
    // between them has to be accounted for, or the window slides up to meet it.
    expect(gapBefore({ end: 116 }, { start: 14_152 })).toBe(14_036);
  });

  it("never returns a negative height", () => {
    // Rows measure themselves, so a re-measure can briefly put `end` past the
    // next `start`; a negative height would be dropped by the DOM anyway.
    expect(gapBefore({ end: 200 }, { start: 180 })).toBe(0);
  });
});
