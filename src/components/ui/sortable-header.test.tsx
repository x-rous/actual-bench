import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  SortableHeader,
  compareValues,
  directionFor,
  nextSortDirection,
  type SortDirection,
} from "./sortable-header";

/**
 * Four feature tables share this header (backups, automations, reconciliation
 * sessions, the diagnostics table browser). Its behaviour used to be asserted
 * only through those views, which meant the tri-state cycle was proven three
 * times over at the cost of a full page render each, and `compareValues` — the
 * part with an actual rule in it — was never tested at all.
 */

function Table({ initial = null }: { initial?: { key: "name"; direction: SortDirection } | null }) {
  const [sort, setSort] = useState(initial);
  return (
    <table>
      <thead>
        <tr>
          <SortableHeader
            label="Name"
            sortKey="name"
            sort={sort}
            onSort={(key, direction) => setSort({ key, direction })}
          />
        </tr>
      </thead>
    </table>
  );
}

describe("nextSortDirection", () => {
  it("cycles ascending → descending → back to the table's own order", () => {
    // The third click matters: a sort you cannot undo forces a reload to see
    // the default ordering again.
    expect(nextSortDirection(null)).toBe("asc");
    expect(nextSortDirection("asc")).toBe("desc");
    expect(nextSortDirection("desc")).toBe(null);
  });
});

describe("directionFor", () => {
  it("reports a direction only for the active column", () => {
    expect(directionFor({ key: "name", direction: "asc" }, "name")).toBe("asc");
    expect(directionFor({ key: "other", direction: "asc" }, "name")).toBe(null);
    expect(directionFor(null, "name")).toBe(null);
  });
});

describe("compareValues", () => {
  it("orders numbers and strings, and reverses for descending", () => {
    expect(compareValues(1, 2, "asc")).toBeLessThan(0);
    expect(compareValues(1, 2, "desc")).toBeGreaterThan(0);
    expect(compareValues("a", "b", "asc")).toBeLessThan(0);
    expect(compareValues("a", "b", "desc")).toBeGreaterThan(0);
    expect(compareValues(2, 2, "asc")).toBe(0);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
  ])("sorts a %s value last in BOTH directions", (_label, missing) => {
    // The rule the views never checked. A backup that has never run is not
    // "older than everything" — it is unknown. Treating it as an empty string
    // would bury it under real data ascending and float it to the top
    // descending, which is how a sorted table misleads.
    expect(compareValues(missing, "anything", "asc")).toBeGreaterThan(0);
    expect(compareValues(missing, "anything", "desc")).toBeGreaterThan(0);
    expect(compareValues("anything", missing, "asc")).toBeLessThan(0);
    expect(compareValues("anything", missing, "desc")).toBeLessThan(0);
  });

  it("treats two missing values as equal, so their relative order is stable", () => {
    expect(compareValues(null, "", "asc")).toBe(0);
    expect(compareValues(undefined, null, "desc")).toBe(0);
  });

  it("does not treat a zero or a false-y number as missing", () => {
    // `0` is a real value: no runs is not the same as an unknown number of runs.
    expect(compareValues(0, 5, "asc")).toBeLessThan(0);
    expect(compareValues(0, null, "asc")).toBeLessThan(0);
  });
});

describe("SortableHeader", () => {
  it("announces its sort state on the column header, not only in an icon", () => {
    render(<Table />);
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "none");

    fireEvent.click(screen.getByRole("button", { name: /sort by name/i }));
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "ascending");

    fireEvent.click(screen.getByRole("button", { name: /sort by name/i }));
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "descending");
  });

  it("carries the current direction in the button's accessible name", () => {
    render(<Table initial={{ key: "name", direction: "asc" }} />);
    expect(
      screen.getByRole("button", { name: "Sort by Name, ascending" }),
    ).toBeInTheDocument();
  });

  it("returns to the table's own order on the third activation", () => {
    render(<Table initial={{ key: "name", direction: "desc" }} />);
    fireEvent.click(screen.getByRole("button", { name: /sort by name/i }));
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "none");
  });
});
