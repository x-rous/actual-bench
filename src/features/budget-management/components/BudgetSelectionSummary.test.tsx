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
});
