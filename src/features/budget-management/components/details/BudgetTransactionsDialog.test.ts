import {
  elapsedDaysInMonths,
  elapsedDaysInRange,
  nextBucketSelection,
  rowBucketLabel,
  rowTimeBucketId,
} from "./budgetTransactionsDialog.helpers";
import type { BudgetTransactionRow } from "../../lib/budgetTransactionsQuery";

/*
 * The "when" panel charts weeks for a single month and months for a range, and
 * clicking a bar filters the table by the bar's id. The row-to-bucket function
 * has to answer in whichever vocabulary is on screen.
 *
 * Getting it wrong is silent: the ids simply never match, every row is filtered
 * out, and the table reads as "no transactions" rather than as a bug. That is
 * exactly what shipped when these drill-throughs learned to span months, so it
 * is pinned here.
 */
describe("rowTimeBucketId", () => {
  describe("a single month, bucketed by week", () => {
    it("puts the first seven days in week 1", () => {
      expect(rowTimeBucketId("2026-03-01", false)).toBe("week-1");
      expect(rowTimeBucketId("2026-03-07", false)).toBe("week-1");
    });

    it("moves to the next week on the eighth", () => {
      expect(rowTimeBucketId("2026-03-08", false)).toBe("week-2");
      expect(rowTimeBucketId("2026-03-15", false)).toBe("week-3");
      expect(rowTimeBucketId("2026-03-22", false)).toBe("week-4");
    });

    it("folds the month's tail into week 5", () => {
      // The chart only draws five, so the 29th onwards joins the last bar
      // rather than falling into a sixth that is never rendered.
      expect(rowTimeBucketId("2026-03-29", false)).toBe("week-5");
      expect(rowTimeBucketId("2026-03-31", false)).toBe("week-5");
    });
  });

  describe("a range, bucketed by month", () => {
    it("answers with the row's own month", () => {
      expect(rowTimeBucketId("2026-03-15", true)).toBe("2026-03");
      expect(rowTimeBucketId("2026-11-01", true)).toBe("2026-11");
    });

    it("does not answer in weeks, which is what emptied the table", () => {
      expect(rowTimeBucketId("2026-03-15", true)).not.toMatch(/^week-/);
    });

    it("separates the same day in different months", () => {
      expect(rowTimeBucketId("2026-03-15", true)).not.toBe(
        rowTimeBucketId("2026-04-15", true)
      );
    });
  });
});

/*
 * The "where" panel lists either categories or payees, and a group can now show
 * both. The same silent failure applies: match a payee's bucket id against a
 * row's category name and nothing ever matches, so clicking a payee empties the
 * table and looks like a period with no transactions in it.
 */
describe("rowBucketLabel", () => {
  const row = (payeeName: string | null, categoryName: string | null): BudgetTransactionRow => ({
    id: "tx",
    date: "2026-04-02",
    amount: -1000,
    payeeName,
    categoryName,
    notes: null,
  });

  it("resolves a row to its payee name", () => {
    expect(rowBucketLabel(row("Carrefour", "Groceries"), "payee", null)).toBe("Carrefour");
    expect(rowBucketLabel(row("Zomato", "Groceries"), "payee", null)).not.toBe("Carrefour");
  });

  it("resolves a row to its category name", () => {
    expect(rowBucketLabel(row("Carrefour", "Groceries"), "category", null)).toBe("Groceries");
    expect(rowBucketLabel(row("Carrefour", "Groceries"), "category", null)).not.toBe("Carrefour");
  });

  it("falls back to the placeholder buckets when a name is missing", () => {
    expect(rowBucketLabel(row(null, "Groceries"), "payee", null)).toBe("No payee");
    expect(rowBucketLabel(row("  ", "Groceries"), "payee", null)).toBe("No payee");
    expect(rowBucketLabel(row("Carrefour", null), "category", null)).toBe("Uncategorized");
  });

  it("reads the payee dimension as a payee whatever was drilled into", () => {
    // The regression: a group used to force the category branch, so every payee
    // click on a group filtered the table down to nothing.
    expect(rowBucketLabel(row(null, "Groceries"), "payee", null)).toBe("No payee");
    expect(rowBucketLabel(row("Carrefour", "Groceries"), "payee", null)).toBe("Carrefour");
  });
});

/*
 * The group dimension has to walk one level up from what a transaction carries.
 * A row names its category and stops there, so the group is resolved through a
 * map built from the loaded months - and a category the map has never heard of
 * has to land somewhere visible rather than silently matching nothing.
 */
describe("rowBucketLabel - group dimension", () => {
  const groups = new Map([
    ["Groceries & Household", "Food & Groceries"],
    ["Fuel", "Transport"],
  ]);
  const row = (categoryName: string | null): BudgetTransactionRow => ({
    id: "tx",
    date: "2026-04-02",
    amount: -1000,
    payeeName: "Carrefour",
    categoryName,
    notes: null,
  });

  it("resolves a row to its category's group", () => {
    expect(rowBucketLabel(row("Fuel"), "group", groups)).toBe("Transport");
    expect(rowBucketLabel(row("Fuel"), "group", groups)).not.toBe("Food & Groceries");
  });

  it("falls back to Ungrouped for a category the map does not cover", () => {
    expect(rowBucketLabel(row("Parking"), "group", groups)).toBe("Ungrouped");
    expect(rowBucketLabel(row(null), "group", groups)).toBe("Ungrouped");
  });

  it("answers Ungrouped for every row when no map is supplied", () => {
    expect(rowBucketLabel(row("Fuel"), "group", null)).toBe("Ungrouped");
  });
});

/*
 * The per-day figure divides by time that has happened, not by the range's
 * calendar length. Getting that wrong is quiet and directional: an in-progress
 * month would read as a fraction of the real burn rate and climb all month as
 * the denominator caught up, which is wrong exactly when the figure is urgent.
 */
describe("elapsedDaysInRange", () => {
  it("counts the whole range when it is entirely in the past", () => {
    const today = new Date("2026-09-15T00:00:00Z");
    // April has 30 days.
    expect(elapsedDaysInRange("2026-04", "2026-04", today)).toBe(30);
    // Jan + Feb (28 in 2026) + Mar.
    expect(elapsedDaysInRange("2026-01", "2026-03", today)).toBe(31 + 28 + 31);
  });

  it("stops at today for a range still running", () => {
    const today = new Date("2026-09-15T00:00:00Z");
    expect(elapsedDaysInRange("2026-09", "2026-09", today)).toBe(15);
    // Aug ran in full; September has run to the 15th.
    expect(elapsedDaysInRange("2026-08", "2026-09", today)).toBe(31 + 15);
  });

  it("counts a range that started today as one day, never zero", () => {
    // A zero denominator would make the rate infinite.
    expect(elapsedDaysInRange("2026-09", "2026-09", new Date("2026-09-01T00:00:00Z"))).toBe(1);
  });

  it("counts a leap February in full", () => {
    expect(elapsedDaysInRange("2028-02", "2028-02", new Date("2028-06-01T00:00:00Z"))).toBe(29);
  });

  it("returns zero for a range entirely in the future or ordered backwards", () => {
    expect(elapsedDaysInRange("2027-01", "2027-01", new Date("2026-09-15T00:00:00Z"))).toBe(0);
    expect(elapsedDaysInRange("2026-06", "2026-01", new Date("2026-09-15T00:00:00Z"))).toBe(0);
  });
});

/*
 * Selecting in the two panels is a set, not a single id. A plain click means
 * "show me only this" because that is what clicking a chart means everywhere;
 * Ctrl (or Cmd) adds and removes, so several categories or months can be
 * compared without finding a parent that contains exactly them.
 *
 * The rule that earns its own test is the plain click on an already-sole
 * selection: it clears, so a click is always its own undo.
 */
describe("nextBucketSelection", () => {
  it("replaces the selection on a plain click", () => {
    expect(nextBucketSelection(["a", "b"], "c", false)).toEqual(["c"]);
    expect(nextBucketSelection([], "c", false)).toEqual(["c"]);
  });

  it("clears when a plain click lands on the only selected bucket", () => {
    expect(nextBucketSelection(["a"], "a", false)).toEqual([]);
  });

  it("keeps a plain click on one of several as a narrowing, not a clear", () => {
    // Undoing here would throw away the other selections, which is not what
    // clicking a highlighted bar among several means.
    expect(nextBucketSelection(["a", "b"], "a", false)).toEqual(["a"]);
  });

  it("adds and removes on a modified click", () => {
    expect(nextBucketSelection(["a"], "b", true)).toEqual(["a", "b"]);
    expect(nextBucketSelection(["a", "b"], "a", true)).toEqual(["b"]);
  });

  it("allows a modified click to empty the selection", () => {
    expect(nextBucketSelection(["a"], "a", true)).toEqual([]);
  });
});

/*
 * A selection of months can have holes in it - Ctrl-click January and March and
 * February is deliberately excluded. Measuring first-to-last would count it
 * anyway, understating the rate by a third and leaving the per-day figure
 * disagreeing with the per-month average beside it.
 */
describe("elapsedDaysInMonths", () => {
  const today = new Date("2026-09-15T00:00:00Z");

  it("sums the months given, skipping the gaps between them", () => {
    // Jan (31) + Mar (31) = 62, not the 90 days that Jan through Mar spans.
    expect(elapsedDaysInMonths(["2026-01", "2026-03"], today)).toBe(62);
    expect(elapsedDaysInRange("2026-01", "2026-03", today)).toBe(90);
  });

  it("agrees with the range form when the months are contiguous", () => {
    expect(elapsedDaysInMonths(["2026-01", "2026-02", "2026-03"], today)).toBe(
      elapsedDaysInRange("2026-01", "2026-03", today)
    );
  });

  it("stops each month at today and drops months not yet started", () => {
    expect(elapsedDaysInMonths(["2026-08", "2026-09"], today)).toBe(31 + 15);
    expect(elapsedDaysInMonths(["2026-09", "2026-12"], today)).toBe(15);
  });

  it("returns zero for an empty selection", () => {
    expect(elapsedDaysInMonths([], today)).toBe(0);
  });
});
