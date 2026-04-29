import { formatMonthLabel } from "@/lib/budget/monthMath";
import { isLargeChange } from "./budgetValidation";
import type { BudgetCellKey, StagedBudgetEdit } from "../types";

export const BUDGET_SAVE_REVIEW_SKIP_KEY =
  "actual-bench:budget-save-review:skip";

export type BudgetSaveReviewCategory = {
  name: string;
  groupName?: string;
};

export type BudgetSaveReviewCategoryLookup = Record<
  string,
  BudgetSaveReviewCategory
>;

export type BudgetSaveReviewEntry = {
  key: BudgetCellKey;
  edit: StagedBudgetEdit;
  categoryName: string;
  groupName?: string;
  delta: number;
  largeChange: boolean;
};

export type BudgetSaveReviewMonth = {
  month: string;
  label: string;
  totalDelta: number;
  entries: BudgetSaveReviewEntry[];
};

export type BudgetSaveReviewSummary = {
  editCount: number;
  monthCount: number;
  totalDelta: number;
  largeChangeCount: number;
  months: BudgetSaveReviewMonth[];
};

export function buildBudgetSaveReviewSummary(
  edits: Record<BudgetCellKey, StagedBudgetEdit>,
  categoryLookup: BudgetSaveReviewCategoryLookup = {}
): BudgetSaveReviewSummary {
  const grouped = new Map<string, BudgetSaveReviewEntry[]>();

  for (const [key, edit] of Object.entries(edits) as [
    BudgetCellKey,
    StagedBudgetEdit,
  ][]) {
    const category = categoryLookup[edit.categoryId];
    const entry: BudgetSaveReviewEntry = {
      key,
      edit,
      categoryName: category?.name ?? edit.categoryId,
      groupName: category?.groupName,
      delta: edit.nextBudgeted - edit.previousBudgeted,
      largeChange: isLargeChange(edit.previousBudgeted, edit.nextBudgeted),
    };
    const entries = grouped.get(edit.month) ?? [];
    entries.push(entry);
    grouped.set(edit.month, entries);
  }

  const months = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, entries]) => {
      const sortedEntries = entries.slice().sort((a, b) => {
        const nameCompare = a.categoryName.localeCompare(b.categoryName);
        return nameCompare !== 0 ? nameCompare : a.key.localeCompare(b.key);
      });
      return {
        month,
        label: formatMonthLabel(month, "long"),
        totalDelta: sortedEntries.reduce((sum, e) => sum + e.delta, 0),
        entries: sortedEntries,
      };
    });

  return {
    editCount: months.reduce((sum, m) => sum + m.entries.length, 0),
    monthCount: months.length,
    totalDelta: months.reduce((sum, m) => sum + m.totalDelta, 0),
    largeChangeCount: months.reduce(
      (sum, m) => sum + m.entries.filter((e) => e.largeChange).length,
      0
    ),
    months,
  };
}

export function readBudgetSaveReviewSkip(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(BUDGET_SAVE_REVIEW_SKIP_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeBudgetSaveReviewSkip(skip: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (skip) {
      window.localStorage.setItem(BUDGET_SAVE_REVIEW_SKIP_KEY, "1");
    } else {
      window.localStorage.removeItem(BUDGET_SAVE_REVIEW_SKIP_KEY);
    }
  } catch {
    // Preference writes are best-effort; saving must still work.
  }
}
