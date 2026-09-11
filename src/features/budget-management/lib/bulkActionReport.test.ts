/**
 * A month the budget file does not have and a month that would not load are
 * different problems. Reporting the second as the first sends the user looking
 * for missing data instead of retrying.
 */
import { describeSkips, hasLoadFailures, NO_SKIPS } from "./bulkActionReport";

describe("describeSkips", () => {
  it("names the months that failed to load, separately from absent data", () => {
    const text = describeSkips({
      ...NO_SKIPS,
      missingSourceMonth: 2,
      failedToLoad: ["2025-03", "2025-04"],
    });
    expect(text).toContain("2 with no source data");
    expect(text).toContain("2 months could not be loaded: 2025-03, 2025-04");
  });

  it("says nothing about loading when every month resolved", () => {
    const text = describeSkips({ ...NO_SKIPS, readOnly: 1 });
    expect(text).toBe("1 skipped - 1 in read-only months");
    expect(hasLoadFailures({ ...NO_SKIPS, readOnly: 1 })).toBe(false);
  });

  it("reports a single failed month in the singular", () => {
    const text = describeSkips({
      ...NO_SKIPS,
      missingSourceMonth: 1,
      failedToLoad: ["2025-03"],
    });
    expect(text).toContain("1 month could not be loaded: 2025-03");
  });
});
