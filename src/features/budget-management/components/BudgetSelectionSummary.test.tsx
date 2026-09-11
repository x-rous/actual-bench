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
  it("names the budgeted total and its per-cell average separately", () => {
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

    // Totals are named, and the averages sit in their own section rather than
    // inline, so a total is never read as a per-cell figure.
    expect(screen.getByLabelText(/Budgeted total: 400\.00/)).toHaveTextContent("Budgeted 400.00");
    expect(screen.getByLabelText(/Average budgeted per cell: 200\.00/)).toHaveTextContent(
      "Budgeted 200.00"
    );
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
    expect(screen.queryByLabelText(/Budgeted total/)).not.toBeInTheDocument();
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
      screen.getByLabelText(/Budgeted income 100\.00, budgeted expenses 300\.00/)
    ).toHaveTextContent("Budgeted inc 100.00 · exp 300.00");
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
  it("names the budgeted total", () => {
    renderSummary("budgeted");
    expect(screen.getByLabelText(/Budgeted total: 400\.00/)).toBeInTheDocument();
  });

  it("names the actual total", () => {
    renderSummary("spent");
    // Every figure is named now, so the view no longer decides which one shows.
    expect(screen.getByLabelText(/Actual total: 380\.00/)).toBeInTheDocument();
  });

  it("names the same figures whatever the grid is showing", () => {
    renderSummary("balance");
    expect(screen.getByLabelText(/Budgeted total: 400\.00/)).toBeInTheDocument();
  });
});

describe("BudgetSelectionSummary budget vs actual", () => {
  it("states the variance between the two", () => {
    renderSummary("budgeted");
    // budgeted 400.00 vs actual 380.00 -> under by 20.00
    expect(screen.getByLabelText(/Variance: under budget by 20\.00/)).toBeInTheDocument();
  });

  it("gives an average for every figure, not just one", () => {
    // An average for budgeted alone invites comparing it against totals.
    renderSummary("budgeted");
    expect(screen.getByLabelText(/Average budgeted per cell: 200\.00/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Average actual per cell: 190\.00/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Average variance per cell/)).toBeInTheDocument();
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

    const control = screen.getByRole("button", { name: /1 staged change in the draft - review them/i });
    expect(control).toHaveTextContent("1 staged");
  });
});

