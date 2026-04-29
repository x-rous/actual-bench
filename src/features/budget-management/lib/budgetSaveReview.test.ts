import {
  BUDGET_SAVE_REVIEW_SKIP_KEY,
  buildBudgetSaveReviewSummary,
  readBudgetSaveReviewSkip,
  writeBudgetSaveReviewSkip,
} from "./budgetSaveReview";
import { LARGE_CHANGE_THRESHOLD } from "./budgetValidation";
import type { BudgetCellKey, StagedBudgetEdit } from "../types";

const edits: Record<BudgetCellKey, StagedBudgetEdit> = {
  "2026-05:cat-b": {
    month: "2026-05",
    categoryId: "cat-b",
    previousBudgeted: 1000,
    nextBudgeted: 2500,
    source: "manual",
  },
  "2026-04:cat-a": {
    month: "2026-04",
    categoryId: "cat-a",
    previousBudgeted: 0,
    nextBudgeted: LARGE_CHANGE_THRESHOLD + 1,
    source: "paste",
  },
  "2026-04:cat-c": {
    month: "2026-04",
    categoryId: "cat-c",
    previousBudgeted: 5000,
    nextBudgeted: 3000,
    source: "bulk-action",
  },
};

describe("buildBudgetSaveReviewSummary", () => {
  it("groups edits by month and computes totals", () => {
    const summary = buildBudgetSaveReviewSummary(edits, {
      "cat-a": { name: "Rent", groupName: "Housing" },
      "cat-b": { name: "Groceries", groupName: "Food" },
      "cat-c": { name: "Utilities", groupName: "Housing" },
    });

    expect(summary.editCount).toBe(3);
    expect(summary.monthCount).toBe(2);
    expect(summary.totalDelta).toBe(LARGE_CHANGE_THRESHOLD - 499);
    expect(summary.largeChangeCount).toBe(1);
    expect(summary.months.map((m) => m.month)).toEqual(["2026-04", "2026-05"]);
    expect(summary.months[0]?.totalDelta).toBe(LARGE_CHANGE_THRESHOLD - 1999);
    expect(summary.months[0]?.entries.map((e) => e.categoryName)).toEqual([
      "Rent",
      "Utilities",
    ]);
  });

  it("falls back to category IDs when names are unavailable", () => {
    const summary = buildBudgetSaveReviewSummary({
      "2026-04:unknown": {
        month: "2026-04",
        categoryId: "unknown",
        previousBudgeted: 100,
        nextBudgeted: 200,
        source: "manual",
      },
    });

    expect(summary.months[0]?.entries[0]?.categoryName).toBe("unknown");
  });
});

describe("budget save review preference", () => {
  afterEach(() => {
    window.localStorage.removeItem(BUDGET_SAVE_REVIEW_SKIP_KEY);
  });

  it("reads and writes the skip-review preference", () => {
    expect(readBudgetSaveReviewSkip()).toBe(false);

    writeBudgetSaveReviewSkip(true);
    expect(window.localStorage.getItem(BUDGET_SAVE_REVIEW_SKIP_KEY)).toBe("1");
    expect(readBudgetSaveReviewSkip()).toBe(true);

    writeBudgetSaveReviewSkip(false);
    expect(readBudgetSaveReviewSkip()).toBe(false);
  });
});
