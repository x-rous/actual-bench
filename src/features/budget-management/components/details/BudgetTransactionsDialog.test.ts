import { rowTimeBucketId } from "./BudgetTransactionsDialog";

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
