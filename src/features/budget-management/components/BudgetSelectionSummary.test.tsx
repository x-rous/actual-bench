import { act, render, screen } from "@testing-library/react";
import { BudgetSelectionSummary } from "./BudgetSelectionSummary";
import type { BudgetCellSelection, LoadedCategory } from "../types";
import { useBudgetEditsStore } from "@/store/budgetEdits";

// The summary reads effective per-month budgeted values from the months
// context; provide a minimal fixture so the sum/average can be computed.
const effective = new Map<
  string,
  { categoriesById: Record<string, { budgeted: number; actuals: number; balance: number }> }
>([
  [
    "2026-08",
    {
      categoriesById: {
        // `actuals` is negative for expenses (money out); balance is the residual.
        a: { budgeted: 10_000, actuals: -8_000, balance: 2_000 },
        b: { budgeted: 30_000, actuals: -30_000, balance: 0 },
      },
    },
  ],
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
        cellView="budgeted"
      />,
    );

    // Sum of 100.00 + 300.00, average 200.00.
    expect(screen.getByLabelText(/Sum of selected: 400\.00/)).toHaveTextContent("Σ 400.00");
    expect(screen.getByLabelText(/Average of selected: 200\.00/)).toHaveTextContent("avg 200.00");
  });

  it("shows no selection stats when nothing is selected", () => {
    render(
      <BudgetSelectionSummary
        selection={null}
        activeMonths={["2026-08"]}
        categories={categories}
        cellView="budgeted"
      />,
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
        cellView="budgeted"
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

// ─── Following the cell-view toggle ───────────────────────────────────────────

function renderSummary(cellView: "budgeted" | "spent" | "balance") {
  const selection: BudgetCellSelection = {
    anchorCategoryId: "a",
    anchorMonth: "2026-08",
    focusCategoryId: "b",
    focusMonth: "2026-08",
  };
  return render(
    <BudgetSelectionSummary
      selection={selection}
      activeMonths={["2026-08"]}
      categories={categories}
      cellView={cellView}
    />
  );
}

describe("BudgetSelectionSummary follows the cell view", () => {
  /**
   * A footer reporting budgeted while the grid shows Spent describes numbers
   * that are nowhere on screen, with nothing saying so.
   */
  it("sums budgeted in the budgeted view", () => {
    renderSummary("budgeted");
    expect(screen.getByLabelText(/Sum of selected: 400\.00/)).toBeInTheDocument();
  });

  it("sums actuals in the spent view", () => {
    renderSummary("spent");
    // -8,000 + -30,000 minor units
    expect(screen.getByLabelText(/Sum of selected: -380\.00/)).toBeInTheDocument();
  });

  it("sums balances in the balance view", () => {
    renderSummary("balance");
    expect(screen.getByLabelText(/Sum of selected: 20\.00/)).toBeInTheDocument();
  });
});

describe("BudgetSelectionSummary budget vs actual", () => {
  it("names the actual and the variance in the budgeted view", () => {
    renderSummary("budgeted");
    // budgeted 400.00 vs actual 380.00 -> under by 20.00
    expect(screen.getByLabelText(/actual for the selection: 380\.00/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Under budget by 20\.00/)).toBeInTheDocument();
  });

  it("names the budget instead when the grid already shows spent", () => {
    renderSummary("spent");
    // Only the measure the sum is not already showing gets named.
    expect(screen.getByLabelText(/budgeted for the selection: 400\.00/)).toBeInTheDocument();
  });

  it("offers no comparison in the balance view", () => {
    renderSummary("balance");
    // A balance is a residual, not a plan to compare against.
    expect(screen.queryByLabelText(/for the selection:/)).not.toBeInTheDocument();
  });
});

describe("BudgetSelectionSummary staged count", () => {
  afterEach(() => {
    // Store updates re-render the mounted summary, so they belong in act().
    act(() => useBudgetEditsStore.getState().discardAll());
  });

  it("says so plainly when nothing is staged", () => {
    renderSummary("budgeted");
    expect(screen.getByText("No staged edits")).toBeInTheDocument();
  });

  it("offers the count as a control, not inert text", () => {
    // It is the obvious thing to click when you want to see what is pending.
    act(() =>
      useBudgetEditsStore.getState().stageEdit({
        month: "2026-08",
        categoryId: "a",
        previousBudgeted: 10_000,
        nextBudgeted: 12_000,
        source: "manual",
      })
    );
    renderSummary("budgeted");

    const control = screen.getByRole("button", { name: /1 total staged edits - review them/i });
    expect(control).toHaveTextContent("1 staged");
  });
});

