import { formatMonthLabel } from "@/lib/budget/monthMath";
import type {
  BudgetCellKey,
  BudgetMode,
  LoadedMonthState,
  RowSelection,
  StagedBudgetEdit,
} from "../types";

export type MonthActualStatus = "past" | "current-partial" | "future";

export type BudgetDetailsSelection =
  | { scope: "period"; entity: "none" }
  | { scope: "period"; entity: "group"; groupId: string }
  | { scope: "period"; entity: "category"; categoryId: string }
  | { scope: "month"; entity: "group"; month: string; groupId: string }
  | { scope: "month"; entity: "category"; month: string; categoryId: string };

export type BudgetDetailsMonth = {
  month: string;
  status: MonthActualStatus;
  state: LoadedMonthState | undefined;
};

export type BudgetDetailsCoverage = {
  totalMonths: number;
  pastCount: number;
  currentCount: number;
  futureCount: number;
  actualLikeCount: number;
  hasFuture: boolean;
  isFutureOnly: boolean;
  label: string;
};

export type BudgetDetailsModel = {
  budgetMode: BudgetMode;
  displayMonths: string[];
  rangeLabel: string;
  selection: BudgetDetailsSelection;
  months: BudgetDetailsMonth[];
  coverage: BudgetDetailsCoverage;
  edits: Record<BudgetCellKey, StagedBudgetEdit>;
};

export function classifyMonthActualStatus(
  month: string,
  now: Date = new Date()
): MonthActualStatus {
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (month < currentMonth) return "past";
  if (month === currentMonth) return "current-partial";
  return "future";
}

export function isActualLikeStatus(status: MonthActualStatus): boolean {
  return status === "past" || status === "current-partial";
}

export function formatBudgetDetailsRange(displayMonths: string[]): string {
  const first = displayMonths[0];
  const last = displayMonths[displayMonths.length - 1];
  if (!first || !last) return "No months selected";
  if (first === last) return formatMonthLabel(first, "long");
  return `${formatMonthLabel(first, "long")} - ${formatMonthLabel(last, "long")}`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildBudgetDetailsCoverage(
  months: BudgetDetailsMonth[]
): BudgetDetailsCoverage {
  let pastCount = 0;
  let currentCount = 0;
  let futureCount = 0;

  for (const entry of months) {
    if (entry.status === "past") pastCount++;
    else if (entry.status === "current-partial") currentCount++;
    else futureCount++;
  }

  const parts: string[] = [];
  if (pastCount > 0) parts.push(`${pastCount} actualized`);
  if (currentCount > 0) {
    parts.push(pluralize(currentCount, "current partial", "current partial"));
  }
  if (futureCount > 0) parts.push(`${futureCount} future plan-only`);

  return {
    totalMonths: months.length,
    pastCount,
    currentCount,
    futureCount,
    actualLikeCount: pastCount + currentCount,
    hasFuture: futureCount > 0,
    isFutureOnly: pastCount + currentCount === 0 && futureCount > 0,
    label: parts.length > 0 ? parts.join(" - ") : "No months selected",
  };
}

export function resolveBudgetDetailsSelection(input: {
  rowSelection: RowSelection | null;
  selectedCategoryId: string | null;
  selectedGroupId: string | null;
  selectedMonth: string | null;
}): BudgetDetailsSelection {
  if (input.rowSelection?.kind === "group") {
    return { scope: "period", entity: "group", groupId: input.rowSelection.id };
  }
  if (input.rowSelection?.kind === "category") {
    return {
      scope: "period",
      entity: "category",
      categoryId: input.rowSelection.id,
    };
  }
  if (input.selectedMonth && input.selectedGroupId) {
    return {
      scope: "month",
      entity: "group",
      month: input.selectedMonth,
      groupId: input.selectedGroupId,
    };
  }
  if (input.selectedMonth && input.selectedCategoryId) {
    return {
      scope: "month",
      entity: "category",
      month: input.selectedMonth,
      categoryId: input.selectedCategoryId,
    };
  }
  if (input.selectedGroupId) {
    return { scope: "period", entity: "group", groupId: input.selectedGroupId };
  }
  if (input.selectedCategoryId) {
    return {
      scope: "period",
      entity: "category",
      categoryId: input.selectedCategoryId,
    };
  }
  return { scope: "period", entity: "none" };
}

export function buildBudgetDetailsModel(input: {
  budgetMode: BudgetMode;
  displayMonths: string[];
  statesByMonth: Map<string, LoadedMonthState>;
  rowSelection: RowSelection | null;
  selectedCategoryId: string | null;
  selectedGroupId: string | null;
  selectedMonth: string | null;
  edits: Record<BudgetCellKey, StagedBudgetEdit>;
}): BudgetDetailsModel {
  const months = input.displayMonths.map((month) => ({
    month,
    status: classifyMonthActualStatus(month),
    state: input.statesByMonth.get(month),
  }));

  return {
    budgetMode: input.budgetMode,
    displayMonths: input.displayMonths,
    rangeLabel: formatBudgetDetailsRange(input.displayMonths),
    selection: resolveBudgetDetailsSelection(input),
    months,
    coverage: buildBudgetDetailsCoverage(months),
    edits: input.edits,
  };
}
