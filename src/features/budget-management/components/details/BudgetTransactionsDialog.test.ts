import {
  elapsedDaysInRange,
  nextBucketSelection,
  rowMatchesSpendBucket,
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
describe("rowMatchesSpendBucket", () => {
  const row = (payeeName: string | null, categoryName: string | null): BudgetTransactionRow => ({
    id: "tx",
    date: "2026-04-02",
    amount: -1000,
    payeeName,
    categoryName,
    notes: null,
  });

  it("matches a payee bucket against the payee name", () => {
    expect(rowMatchesSpendBucket(row("Carrefour", "Groceries"), "Carrefour", "payee")).toBe(true);
    expect(rowMatchesSpendBucket(row("Zomato", "Groceries"), "Carrefour", "payee")).toBe(false);
  });

  it("matches a category bucket against the category name", () => {
    expect(rowMatchesSpendBucket(row("Carrefour", "Groceries"), "Groceries", "category")).toBe(true);
    expect(rowMatchesSpendBucket(row("Carrefour", "Groceries"), "Carrefour", "category")).toBe(false);
  });

  it("matches the placeholder buckets a missing name falls into", () => {
    expect(rowMatchesSpendBucket(row(null, "Groceries"), "No payee", "payee")).toBe(true);
    expect(rowMatchesSpendBucket(row("  ", "Groceries"), "No payee", "payee")).toBe(true);
    expect(rowMatchesSpendBucket(row("Carrefour", null), "Uncategorized", "category")).toBe(true);
  });

  it("reads a payee bucket as a payee even for a group drill-through", () => {
    // The regression: a group used to force the category branch, so every payee
    // click on a group filtered the table down to nothing.
    expect(rowMatchesSpendBucket(row(null, "Groceries"), "No payee", "payee")).toBe(true);
    expect(rowMatchesSpendBucket(row("Carrefour", "Groceries"), "Carrefour", "payee")).toBe(true);
  });
});

/*
 * The group dimension has to walk one level up from what a transaction carries.
 * A row names its category and stops there, so the group is resolved through a
 * map built from the loaded months - and a category the map has never heard of
 * has to land somewhere visible rather than silently matching nothing.
 */
describe("rowMatchesSpendBucket - group dimension", () => {
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
    expect(rowMatchesSpendBucket(row("Fuel"), "Transport", "group", groups)).toBe(true);
    expect(rowMatchesSpendBucket(row("Fuel"), "Food & Groceries", "group", groups)).toBe(false);
  });

  it("falls back to Ungrouped for a category the map does not cover", () => {
    expect(rowMatchesSpendBucket(row("Parking"), "Ungrouped", "group", groups)).toBe(true);
    expect(rowMatchesSpendBucket(row(null), "Ungrouped", "group", groups)).toBe(true);
  });

  it("answers Ungrouped for every row when no map is supplied", () => {
    expect(rowMatchesSpendBucket(row("Fuel"), "Ungrouped", "group", null)).toBe(true);
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
