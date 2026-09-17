import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEditableGrid } from "./useEditableGrid";

const COLUMNS = ["name", "type"] as const;
type Col = (typeof COLUMNS)[number];

const ALL_ROWS = ["r0", "r1", "r2", "r3", "r4"];

/**
 * Stands in for a virtualised table: only the rows inside `window` are mounted,
 * and `onRevealRow` moves the window the way `scrollToIndex` would.
 */
function WindowedGrid({
  windowSize = 2,
  onRevealRow,
}: {
  windowSize?: number;
  onRevealRow?: (index: number) => void;
}) {
  const [start, setStart] = useState(0);

  const { containerRef, selectedCell, selectCell, handleGridKeyDown } = useEditableGrid<Col>({
    rowIds: ALL_ROWS,
    columns: COLUMNS,
    onRevealRow: (index) => {
      onRevealRow?.(index);
      setStart(Math.max(0, index - windowSize + 1));
    },
  });

  const visible = ALL_ROWS.slice(start, start + windowSize);

  return (
    <div ref={containerRef} onKeyDown={handleGridKeyDown} tabIndex={-1} data-testid="grid">
      <div data-testid="selected">{selectedCell ? `${selectedCell.rowId}:${selectedCell.colId}` : "none"}</div>
      {visible.map((rowId) =>
        COLUMNS.map((colId) => (
          <button
            key={`${rowId}:${colId}`}
            data-cell={`${rowId}:${colId}`}
            onClick={() => selectCell(rowId, colId)}
          >
            {rowId}:{colId}
          </button>
        ))
      )}
    </div>
  );
}

/**
 * The search box lives inside the grid container in the real tables, so the
 * grid must not pull focus out of it as the row list changes underneath.
 */
function SearchableGrid() {
  const [query, setQuery] = useState("");
  const rowIds = ALL_ROWS.filter((id) => id.includes(query));

  const { containerRef, selectCell, handleGridKeyDown } = useEditableGrid<Col>({
    rowIds,
    columns: COLUMNS,
  });

  return (
    <div ref={containerRef} onKeyDown={handleGridKeyDown} tabIndex={-1}>
      <input aria-label="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      {rowIds.map((rowId) =>
        COLUMNS.map((colId) => (
          <button
            key={`${rowId}:${colId}`}
            data-cell={`${rowId}:${colId}`}
            onClick={() => selectCell(rowId, colId)}
          >
            {rowId}:{colId}
          </button>
        ))
      )}
    </div>
  );
}

describe("useEditableGrid focus across a windowed list", () => {
  it("focuses a selected cell that is already mounted", async () => {
    render(<WindowedGrid />);

    fireEvent.click(screen.getByRole("button", { name: "r0:name" }));

    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute("data-cell", "r0:name");
    });
  });

  it("reveals the row when arrowing past the bottom of the window, then focuses it", async () => {
    const onRevealRow = jest.fn();
    render(<WindowedGrid onRevealRow={onRevealRow} />);

    // r0 and r1 are mounted; r2 is not.
    fireEvent.click(screen.getByRole("button", { name: "r1:name" }));
    expect(screen.queryByRole("button", { name: "r2:name" })).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId("grid"), { key: "ArrowDown" });

    // The hook asked for the offscreen row by its index in the full list.
    expect(onRevealRow).toHaveBeenCalledWith(2);
    expect(screen.getByTestId("selected")).toHaveTextContent("r2:name");

    // Once mounted, it takes focus - the selection is visible, not silent.
    expect(screen.getByRole("button", { name: "r2:name" })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute("data-cell", "r2:name");
    });
  });

  it("reveals the next row when Tab wraps past the last column", async () => {
    const onRevealRow = jest.fn();
    render(<WindowedGrid onRevealRow={onRevealRow} />);

    fireEvent.click(screen.getByRole("button", { name: "r1:type" }));

    fireEvent.keyDown(screen.getByTestId("grid"), { key: "Tab" });

    expect(onRevealRow).toHaveBeenCalledWith(2);
    expect(screen.getByTestId("selected")).toHaveTextContent("r2:name");
  });

  it("does nothing when the table is not windowed and the cell is absent", async () => {
    // No onRevealRow: the three non-virtualised tables must keep working.
    render(<WindowedGrid windowSize={ALL_ROWS.length} />);

    fireEvent.click(screen.getByRole("button", { name: "r4:type" }));

    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute("data-cell", "r4:type");
    });
  });
});

describe("useEditableGrid and a search box inside the grid", () => {
  it("leaves the caret in the search box when the row list changes", async () => {
    render(<SearchableGrid />);

    // Select a cell first, so there is something for the grid to focus.
    fireEvent.click(screen.getByRole("button", { name: "r1:name" }));
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute("data-cell", "r1:name");
    });

    const search = screen.getByLabelText("search");
    search.focus();
    fireEvent.change(search, { target: { value: "r1" } });

    // Rebuilding the row map must not drag focus back onto the selected cell.
    await waitFor(() => {
      expect(screen.getAllByRole("button")).toHaveLength(COLUMNS.length);
    });
    expect(document.activeElement).toBe(search);
  });
});
