import {
  buildCategorySearchOptions,
  filterCategorySearchOptions,
} from "./categorySearch";
import type { LoadedCategory, LoadedGroup } from "../types";

const groupsById: Record<string, LoadedGroup> = {
  food: {
    id: "food",
    name: "Food",
    isIncome: false,
    hidden: false,
    categoryIds: ["groceries", "restaurants"],
    budgeted: 0,
    actuals: 0,
    balance: 0,
  },
  archived: {
    id: "archived",
    name: "Archived",
    isIncome: false,
    hidden: true,
    categoryIds: ["old-cat"],
    budgeted: 0,
    actuals: 0,
    balance: 0,
  },
  income: {
    id: "income",
    name: "Income",
    isIncome: true,
    hidden: false,
    categoryIds: ["paycheck"],
    budgeted: 0,
    actuals: 0,
    balance: 0,
  },
};

const categoriesById: Record<string, LoadedCategory> = {
  groceries: {
    id: "groceries",
    name: "Groceries",
    groupId: "food",
    groupName: "Food",
    isIncome: false,
    hidden: false,
    budgeted: 0,
    actuals: 0,
    balance: 0,
    carryover: false,
  },
  restaurants: {
    id: "restaurants",
    name: "Restaurants",
    groupId: "food",
    groupName: "Food",
    isIncome: false,
    hidden: true,
    budgeted: 0,
    actuals: 0,
    balance: 0,
    carryover: false,
  },
  "old-cat": {
    id: "old-cat",
    name: "Old Category",
    groupId: "archived",
    groupName: "Archived",
    isIncome: false,
    hidden: false,
    budgeted: 0,
    actuals: 0,
    balance: 0,
    carryover: false,
  },
  paycheck: {
    id: "paycheck",
    name: "Paycheck",
    groupId: "income",
    groupName: "Income",
    isIncome: true,
    hidden: false,
    budgeted: 0,
    actuals: 0,
    balance: 0,
    carryover: false,
  },
};

describe("buildCategorySearchOptions", () => {
  it("includes visible, hidden, and hidden-group categories in visual section order", () => {
    const options = buildCategorySearchOptions({
      groupOrder: ["income", "food", "archived"],
      groupsById,
      categoriesById,
    });

    expect(options.map((option) => option.categoryId)).toEqual([
      "groceries",
      "restaurants",
      "old-cat",
      "paycheck",
    ]);
    expect(options.find((option) => option.categoryId === "restaurants")?.hidden).toBe(true);
    expect(options.find((option) => option.categoryId === "old-cat")?.groupHidden).toBe(true);
  });
});

describe("filterCategorySearchOptions", () => {
  it("matches by category name or group name", () => {
    const options = buildCategorySearchOptions({
      groupOrder: ["income", "food", "archived"],
      groupsById,
      categoriesById,
    });

    expect(filterCategorySearchOptions(options, "gro").map((o) => o.categoryId)).toEqual(["groceries"]);
    expect(filterCategorySearchOptions(options, "food").map((o) => o.categoryId)).toEqual([
      "groceries",
      "restaurants",
    ]);
  });

  it("ranks category name matches before group name matches", () => {
    const options = buildCategorySearchOptions({
      groupOrder: ["income", "food", "archived"],
      groupsById,
      categoriesById,
    });

    expect(filterCategorySearchOptions(options, "pay").map((o) => o.categoryId)).toEqual(["paycheck"]);
  });

  it("supports fuzzy subsequence matches", () => {
    const options = buildCategorySearchOptions({
      groupOrder: ["income", "food", "archived"],
      groupsById,
      categoriesById,
    });

    expect(filterCategorySearchOptions(options, "grcr").map((o) => o.categoryId)).toEqual(["groceries"]);
  });

  it("preserves visual order for equal-rank matches", () => {
    const options = buildCategorySearchOptions({
      groupOrder: ["income", "food", "archived"],
      groupsById,
      categoriesById,
    });

    expect(filterCategorySearchOptions(options, "food").map((o) => o.categoryId)).toEqual([
      "groceries",
      "restaurants",
    ]);
  });
});
