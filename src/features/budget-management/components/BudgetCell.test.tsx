/**
 * Navigating the window past the end of the budget file used to show the first
 * visible month's figures in every empty column.
 *
 * `category` comes from the cross-month merged structure (BM-13), which is what
 * makes a category reachable in a month whose payload has not loaded. Its
 * *numbers*, though, belong to whichever month it was merged from - so falling
 * back to them printed another month's values as if they were this one's.
 */
import { render, screen } from "@testing-library/react";
import { BudgetCell } from "./BudgetCell";
import type { LoadedCategory } from "../types";

// No month state for any month - the case for a month the budget file lacks.
let monthState: { categoriesById: Record<string, LoadedCategory> } | undefined;

jest.mock("../context/MonthsDataContext", () => ({
  useEffectiveMonthFromContext: () => monthState,
}));

jest.mock("@/hooks/useAllNotes", () => ({ useAllNotes: () => ({ data: {} }) }));

const category = {
  id: "c1",
  name: "Groceries",
  groupId: "g1",
  groupName: "Everyday",
  isIncome: false,
  hidden: false,
  // The merged structure carries the first visible month's figures.
  budgeted: 45_000,
  actuals: -20_000,
  balance: 25_000,
  carryover: true,
} as LoadedCategory;

function renderCell(overrides: Partial<Parameters<typeof BudgetCell>[0]> = {}) {
  return render(
    <BudgetCell
      category={category}
      month="2027-06"
      budgetMode="envelope"
      cellView="budgeted"
      isSelected={false}
      isAnchor={false}
      onFocus={() => {}}
      onRangeSelect={() => {}}
      {...overrides}
    />
  );
}

describe("BudgetCell in a month the budget file does not have", () => {
  afterEach(() => {
    monthState = undefined;
  });

  it("shows nothing rather than another month's figures", () => {
    monthState = undefined;
    const { container } = renderCell();
    expect(container.textContent).toBe("");
    expect(screen.queryByText("450.00")).not.toBeInTheDocument();
  });

  it("does the same in the spent and balance views", () => {
    monthState = undefined;
    const { container, rerender } = renderCell({ cellView: "spent" });
    expect(container.textContent).toBe("");

    rerender(
      <BudgetCell
        category={category}
        month="2027-06"
        budgetMode="envelope"
        cellView="balance"
        isSelected={false}
        isAnchor={false}
        onFocus={() => {}}
        onRangeSelect={() => {}}
      />
    );
    expect(container.textContent).toBe("");
    expect(screen.queryByText("250.00")).not.toBeInTheDocument();
  });

  it("shows the month's own figures once it has them", () => {
    monthState = {
      categoriesById: { c1: { ...category, budgeted: 10_000 } },
    };
    renderCell();
    expect(screen.getByText("100.00")).toBeInTheDocument();
  });

  it("does not mark an empty month as forbidden", () => {
    // A month the budget simply does not have is empty, not an error - the
    // not-allowed cursor belongs to a cell that refuses an action.
    monthState = undefined;
    const { container } = renderCell({ isReadOnlyMonth: true });
    expect((container.firstElementChild as HTMLElement).className).not.toContain(
      "cursor-not-allowed"
    );
  });

  it("keeps the exact figure reachable when decimals are hidden", () => {
    // The budgeted view has its own tooltip; without folding the exact value
    // into it, the view most likely to be read rounded is the one place the
    // real number cannot be found.
    monthState = { categoriesById: { c1: { ...category, budgeted: 332_908 } } };
    const { container } = renderCell({ showDecimals: false });
    expect(screen.getByText("3,329")).toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).title).toContain("3,329.08");
  });
});
