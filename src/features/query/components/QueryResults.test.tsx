import { render, screen } from "@testing-library/react";
import {
  QueryResults,
  computeColumnWidths,
  getColumns,
  sortRows,
} from "./QueryResults";

jest.mock("sonner", () => ({
  toast: Object.assign(jest.fn(), { error: jest.fn(), success: jest.fn(), warning: jest.fn() }),
}));

const rows = [
  { id: "t-1", date: "2026-08-14", amount: -4429, "payee.name": "Neighborhood Pet Supply" },
  { id: "t-2", date: "2026-08-14", amount: -6355, "payee.name": "Chevron" },
];

/**
 * The results toolbar carries four tabs, four measurements and up to four
 * actions. Beside an open examples panel they did not fit one line: the
 * measurements ran over the last tab and the final action was clipped off the
 * edge - at 1440px, which is an ordinary laptop.
 */
describe("the results toolbar", () => {
  it("keeps every tab, measurement and action on screen together", () => {
    render(
      <QueryResults
        result={rows}
        isRunning={false}
        error={null}
        execTime={248}
        payloadBytes={3891}
        lastRequest={{
          mode: "http-api",
          query: { table: "transactions" } as never,
          rawQuery: '{"table":"transactions"}',
          baseUrl: "https://api.example.com",
          budgetSyncId: "b-1",
          apiKey: "key",
        }}
      />
    );

    for (const tab of ["Table", "Raw JSON", "Scalar", "Tree"]) {
      expect(screen.getByRole("tab", { name: tab })).toBeInTheDocument();
    }
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("248ms")).toBeInTheDocument();
    for (const action of ["Export CSV", "Copy JSON", "Copy HTTP cURL", "cURL + secrets"]) {
      expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
    }
  });

  it("wraps rather than overlapping when the row runs out of width", () => {
    // jsdom cannot measure layout, so this pins the mechanism: the tabs never
    // compress, and the actions move to a second line instead of over them.
    const { container } = render(
      <QueryResults result={rows} isRunning={false} error={null} execTime={248} payloadBytes={3891} />
    );

    const bar = container.querySelector(".border-b");
    expect(bar?.className).toContain("flex-wrap");
    expect(bar?.firstElementChild?.className).toContain("shrink-0");
    // Sized by its content, or it shrinks to nothing on one line instead of
    // wrapping - and its contents spill out, which is the overlap itself.
    expect(bar?.lastElementChild?.className).toContain("basis-auto");
  });

  it("shows no measurements before a query has run", () => {
    render(<QueryResults result={null} isRunning={false} error={null} />);

    expect(screen.queryByText("OK")).not.toBeInTheDocument();
  });
});

/*
 * The table used to render only the first five hundred rows, and derived its
 * columns and its sort order from that slice. Both were then quietly wrong
 * rather than merely partial - a sort returned the extremes of the slice and
 * called them the extremes, and a column that first carried a value further
 * down did not exist at all. The row cap is gone; these pin the behaviour that
 * replaced it.
 *
 * The virtualised rendering itself is not covered, and cannot be: jsdom reports
 * every element as zero-sized, so the virtualiser yields an empty window whether
 * the code is right or wrong. A test asserting over that would pass against the
 * broken version, which is worse than no test because it reads as cover.
 */
describe("reading the whole result set", () => {
  const wide = [
    ...Array.from({ length: 600 }, (_, i) => ({ id: `t-${i}`, amount: -100 })),
    { id: "t-600", amount: -999999, memo: "only row with a memo" },
  ];

  it("finds a column that first appears beyond the old cap", () => {
    expect(getColumns(wide)).toContain("memo");
  });

  it("sorts to the true extreme, not the extreme of the first page", () => {
    const sorted = sortRows(wide, "amount", "asc");
    expect(sorted[0]!.id).toBe("t-600");
  });

  it("keeps rows when no column is sorted", () => {
    expect(sortRows(wide, "amount", "asc")).toHaveLength(wide.length);
  });
});

describe("computeColumnWidths", () => {
  const cents = new Set<string>();

  it("sizes a column to its widest sampled value", () => {
    const widths = computeColumnWidths(
      [{ payee: "A" }, { payee: "a much longer payee name" }],
      ["payee"],
      cents
    );
    // 24 characters plus two of slack.
    expect(widths.payee).toBe(26);
  });

  it("never sizes a column below the floor or above the ceiling", () => {
    const narrow = computeColumnWidths([{ id: "x" }], ["id"], cents);
    expect(narrow.id).toBe(8);

    const huge = computeColumnWidths([{ notes: "z".repeat(500) }], ["notes"], cents);
    expect(huge.notes).toBe(40);
  });

  it("accounts for a header longer than any of its values", () => {
    const widths = computeColumnWidths([{ "transfer.account.name": "x" }], ["transfer.account.name"], cents);
    expect(widths["transfer.account.name"]).toBe(23);
  });

  it("ignores rows past the sample, so the pass stays bounded", () => {
    // The long value sits at row 300, outside the 200-row sample: the column
    // truncates rather than the table paying to measure every row.
    const rows = [
      ...Array.from({ length: 300 }, () => ({ memo: "short" })),
      { memo: "a very long memo that would widen the column if it were sampled" },
    ];
    expect(computeColumnWidths(rows, ["memo"], cents).memo).toBe(8);
  });

  it("returns a width for every column, including one that is always empty", () => {
    const widths = computeColumnWidths([{ a: 1, b: null }], ["a", "b"], cents);
    expect(Object.keys(widths).sort()).toEqual(["a", "b"]);
  });
});

/*
 * The one part of the virtualised table that jsdom can still see.
 *
 * The header is not windowed - only the body is - so the column list is
 * observable in a test even though the rows are not. That matters, because the
 * pure-function tests above pass whether the component hands them every row or
 * only the first five hundred: the functions were always correct and the bug
 * was in what was passed to them. This asserts the wiring.
 */
describe("the table header over a result larger than the old cap", () => {
  const late = [
    ...Array.from({ length: 600 }, (_, i) => ({ id: `t-${i}`, amount: -100 })),
    { id: "t-600", amount: -100, settled_in_full: true },
  ];

  it("lists a column that first appears past row 500", () => {
    render(
      <QueryResults
        result={late}
        isRunning={false}
        error={null}
        execTime={10}
        payloadBytes={100}
        lastRequest={null}
      />
    );
    expect(
      screen.getByRole("button", { name: /settled_in_full/ })
    ).toBeInTheDocument();
  });

  it("no longer says it is showing only the first 500", () => {
    render(
      <QueryResults
        result={late}
        isRunning={false}
        error={null}
        execTime={10}
        payloadBytes={100}
        lastRequest={null}
      />
    );
    expect(screen.queryByText(/Showing first/)).not.toBeInTheDocument();
    expect(screen.getAllByText("601 rows").length).toBeGreaterThan(0);
  });
});
