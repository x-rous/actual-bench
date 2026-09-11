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
  it("names the budgeted total with its per-cell average", () => {
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
    expect(screen.getByLabelText(/Budgeted total: 400\.00/)).toHaveTextContent(
      "Budgeted 400.00 (200.00)"
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

    // Mixed selections get their own Budgeted zone with both sides named, and
    // no variance - one plan-versus-actual across both answers neither.
    expect(
      screen.getByLabelText(/Budgeted income 100\.00, budgeted expenses 300\.00/)
    ).toHaveTextContent("Budgeted income 100.00");
    expect(screen.getByText("expenses")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Variance/)).not.toBeInTheDocument();
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

  it("pairs every total with its own per-cell average", () => {
    // One group, not two: each measure is named once and carries its average
    // in brackets, rather than repeating three labels in a second group.
    renderSummary("budgeted");
    expect(
      screen.getByLabelText(/Budgeted total: 400\.00, averaging 200\.00 per cell/)
    ).toHaveTextContent("Budgeted 400.00 (200.00)");
    expect(
      screen.getByLabelText(/Actual total: 380\.00, averaging 190\.00 per cell/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Variance.*averaging/)).toBeInTheDocument();
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

describe("BudgetSelectionSummary layout", () => {
  /**
   * The footer carries four unrelated kinds of fact. Captions and rules are
   * what make each findable by where it sits, rather than by reading the row
   * left to right looking for it.
   */
  it("keeps the bar to a single row", () => {
    const { container } = renderSummary("budgeted");
    // A status bar under a dense grid should not grow to fit its contents;
    // the design has to make the contents fit the bar.
    expect((container.firstElementChild as HTMLElement).className).toContain("h-8");
  });

  it("separates the areas with rules rather than running them together", () => {
    const { container } = renderSummary("budgeted");
    expect(container.querySelectorAll(".divide-x").length).toBeGreaterThan(0);
  });

  it("renders nothing at all when there is no selection", () => {
    // The bar summarises a selection. With none, the draft count and its review
    // dialog are already on the details panel, so an empty strip of chrome
    // under the grid would say nothing.
    const { container } = render(
      <BudgetSelectionSummary
        selection={null}
        activeMonths={["2026-08"]}
        categories={categories}
        cellView="budgeted"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("BudgetSelectionSummary mixed selections follow the view", () => {
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

  function renderMixed(cellView: "budgeted" | "spent" | "balance") {
    render(
      <BudgetSelectionSummary
        selection={selection}
        activeMonths={["2026-08"]}
        categories={mixedCategories}
        cellView={cellView}
      />
    );
  }

  /**
   * A mixed selection shows one measure per side rather than the full trio, so
   * it is the one place the view still decides what is displayed - and so the
   * one place the label has to follow it.
   */
  it("labels the split Budgeted in the budgeted view", () => {
    renderMixed("budgeted");
    expect(screen.getByLabelText(/Budgeted income/)).toBeInTheDocument();
  });

  it("labels it Actual when the grid shows spent", () => {
    renderMixed("spent");
    expect(screen.getByLabelText(/Actual income/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Budgeted income/)).not.toBeInTheDocument();
  });

  it("labels it Balance in the balance view", () => {
    renderMixed("balance");
    expect(screen.getByLabelText(/Balance income/)).toBeInTheDocument();
  });
});

describe("BudgetSelectionSummary counts holds", () => {
  afterEach(() => {
    act(() => useBudgetEditsStore.getState().discardAll());
  });

  it("counts a hold alongside edits when a selection is showing", () => {
    // A hold is stageable on its own, and the review dialog counts it - the
    // footer used to count edits only and so hid the way into that dialog.
    act(() =>
      useBudgetEditsStore.getState().stageHold({
        month: "2026-08",
        previousAmount: 0,
        nextAmount: 5_000,
      })
    );
    renderSummary("budgeted");
    expect(screen.queryByText("No staged edits")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /staged change/i })).toBeInTheDocument();
  });
});

