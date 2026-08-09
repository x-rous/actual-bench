import { render, screen } from "@testing-library/react";
import { BudgetSelectionSummary } from "./BudgetSelectionSummary";
import type { BudgetCellSelection, LoadedCategory } from "../types";

// The summary reads effective per-month budgeted values from the months
// context; provide a minimal fixture so the sum/average can be computed.
const effective = new Map<string, { categoriesById: Record<string, { budgeted: number }> }>([
  ["2026-08", { categoriesById: { a: { budgeted: 10_000 }, b: { budgeted: 30_000 } } }],
]);

jest.mock("../context/MonthsDataContext", () => ({
  useMonthsData: () => ({ effective }),
}));

const categories = [
  { id: "a", name: "Groceries" },
  { id: "b", name: "Rent" },
] as unknown as LoadedCategory[];

describe("BudgetSelectionSummary sum/average", () => {
  it("shows the sum and average of the selected cells' budgeted values", () => {
    const selection: BudgetCellSelection = {
      anchorCategoryId: "a",
      anchorMonth: "2026-08",
      focusCategoryId: "b",
      focusMonth: "2026-08",
    };

    render(
      <BudgetSelectionSummary
        selection={selection}
        activeMonths={["2026-08"]}
        categories={categories}
      />,
    );

    // Sum of 100.00 + 300.00, average 200.00.
    expect(screen.getByLabelText(/Sum of selected: 400\.00/)).toHaveTextContent("Σ 400.00");
    expect(screen.getByLabelText(/Average of selected: 200\.00/)).toHaveTextContent("avg 200.00");
  });

  it("shows no selection stats when nothing is selected", () => {
    render(
      <BudgetSelectionSummary selection={null} activeMonths={["2026-08"]} categories={categories} />,
    );
    expect(screen.queryByLabelText(/Sum of selected/)).not.toBeInTheDocument();
  });

  it("splits into income/expense subtotals for a mixed selection (BM-35)", () => {
    // `a` is income (+10,000), `b` is expense (30,000 magnitude) — a single net
    // would be meaningless, so both sides are shown separately and there is no
    // combined Σ or average.
    const mixedCategories = [
      { id: "a", name: "Salary", isIncome: true },
      { id: "b", name: "Rent", isIncome: false },
    ] as unknown as LoadedCategory[];
    const selection: BudgetCellSelection = {
      anchorCategoryId: "a",
      anchorMonth: "2026-08",
      focusCategoryId: "b",
      focusMonth: "2026-08",
    };

    render(
      <BudgetSelectionSummary
        selection={selection}
        activeMonths={["2026-08"]}
        categories={mixedCategories}
      />,
    );

    expect(
      screen.getByLabelText(/income budgets: 100\.00; sum of selected expense budgets: 300\.00/)
    ).toHaveTextContent("Σ inc 100.00 · exp 300.00");
    // No single combined total or average for a mixed selection.
    expect(screen.queryByLabelText(/^Sum of selected: /)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Average of selected/)).not.toBeInTheDocument();
  });
});
