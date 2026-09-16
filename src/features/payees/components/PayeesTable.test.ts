import { withEditingRow } from "./PayeesTable";

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
