/**
 * BM-12: the optimistic post-save reducer must project a budget edit the same
 * way the staged reducer (`computeEffectiveMonthState` Layer 2) does, so the
 * grid never jumps when a save swaps the staged overlay for the saved value.
 * These tests pin that convergence, mode by mode.
 */

// The module under test imports the Actual transport + connection store at load
// time; stub them so importing the pure reducer has no side effects.
jest.mock("../../../lib/actual", () => ({ getTransport: jest.fn() }));
jest.mock("../../../store/connection", () => ({
  useConnectionStore: jest.fn(),
  selectActiveInstance: jest.fn(),
}));

import { applyBudgetedToMonthState } from "./useBudgetSave";
import { computeEffectiveMonthState } from "../lib/effectiveMonth";
import type {
  BudgetCellKey,
  LoadedCategory,
  LoadedGroup,
  LoadedMonthState,
  StagedBudgetEdit,
} from "../types";

function category(overrides: Partial<LoadedCategory>): LoadedCategory {
  return {
    id: "cat",
    name: "Category",
    groupId: "group",
    groupName: "Group",
    isIncome: false,
    hidden: false,
    budgeted: 0,
    actuals: 0,
    balance: 0,
    carryover: false,
    ...overrides,
  };
}

function group(overrides: Partial<LoadedGroup>): LoadedGroup {
  return {
    id: "group",
    name: "Group",
    isIncome: false,
    hidden: false,
    categoryIds: [],
    budgeted: 0,
    actuals: 0,
    balance: 0,
    ...overrides,
  };
}

// One visible group holding a visible + a hidden category, and a fully hidden
// group with its own category — enough to exercise every mode-aware branch.
function state(): LoadedMonthState {
  return {
    summary: {
      month: "2026-04",
      incomeAvailable: 0,
      lastMonthOverspent: 0,
      forNextMonth: 0,
      totalBudgeted: -300_000,
      toBudget: 0,
      fromLastMonth: 0,
      totalIncome: 0,
      totalSpent: 0,
      totalBalance: 300_000,
    },
    groupOrder: ["visible-group", "hidden-group"],
    groupsById: {
      "visible-group": group({
        id: "visible-group",
        categoryIds: ["visible-cat", "hidden-cat"],
        budgeted: -200_000,
        balance: 200_000,
      }),
      "hidden-group": group({
        id: "hidden-group",
        hidden: true,
        categoryIds: ["in-hidden-group"],
        budgeted: -100_000,
        balance: 100_000,
      }),
    },
    categoriesById: {
      "visible-cat": category({
        id: "visible-cat",
        groupId: "visible-group",
        budgeted: -120_000,
        balance: 120_000,
      }),
      "hidden-cat": category({
        id: "hidden-cat",
        groupId: "visible-group",
        hidden: true,
        budgeted: -80_000,
        balance: 80_000,
      }),
      "in-hidden-group": category({
        id: "in-hidden-group",
        groupId: "hidden-group",
        budgeted: -100_000,
        balance: 100_000,
      }),
    },
  };
}

function stagedEquivalent(
  base: LoadedMonthState,
  categoryId: string,
  nextBudgeted: number,
  isTracking: boolean
): LoadedMonthState {
  const cat = base.categoriesById[categoryId]!;
  const edit: StagedBudgetEdit = {
    month: "2026-04",
    categoryId,
    previousBudgeted: cat.budgeted,
    nextBudgeted,
    source: "manual",
  };
  return computeEffectiveMonthState({
    serverState: base,
    allEdits: { [`2026-04:${categoryId}` as BudgetCellKey]: edit },
    isTracking,
    incomeBudgets: undefined,
    month: "2026-04",
  })!;
}

describe("applyBudgetedToMonthState (BM-12 convergence)", () => {
  const cases: Array<{ name: string; categoryId: string; isTracking: boolean }> = [
    { name: "envelope visible category", categoryId: "visible-cat", isTracking: false },
    { name: "envelope hidden category", categoryId: "hidden-cat", isTracking: false },
    { name: "tracking visible category", categoryId: "visible-cat", isTracking: true },
    { name: "tracking hidden category in a visible group", categoryId: "hidden-cat", isTracking: true },
    { name: "tracking category inside a hidden group", categoryId: "in-hidden-group", isTracking: true },
  ];

  it.each(cases)("matches the staged reducer for a $name edit", ({ categoryId, isTracking }) => {
    const base = state();
    const next = base.categoriesById[categoryId]!.budgeted - 30_000;

    const optimistic = applyBudgetedToMonthState(base, categoryId, next, isTracking);
    const staged = stagedEquivalent(base, categoryId, next, isTracking);

    expect(optimistic.summary).toEqual(staged.summary);
    expect(optimistic.groupsById).toEqual(staged.groupsById);
    expect(optimistic.categoriesById[categoryId]).toEqual(
      staged.categoriesById[categoryId]
    );
  });

  it("excludes a hidden Tracking category from the summary and its visible group", () => {
    const base = state();
    const result = applyBudgetedToMonthState(base, "hidden-cat", -110_000, true);

    // Category itself still moves…
    expect(result.categoriesById["hidden-cat"]!.budgeted).toBe(-110_000);
    // …but the visible parent group and the summary are untouched.
    expect(result.groupsById["visible-group"]).toEqual(base.groupsById["visible-group"]);
    expect(result.summary).toEqual(base.summary);
  });

  it("keeps a hidden Envelope category financially active in the summary", () => {
    const base = state();
    const result = applyBudgetedToMonthState(base, "hidden-cat", -110_000, false);

    // delta = -30,000 → totalBudgeted -= delta → -300,000 - (-30,000) = -270,000
    expect(result.summary.totalBudgeted).toBe(-270_000);
    expect(result.groupsById["visible-group"]!.budgeted).toBe(-230_000);
  });
});
