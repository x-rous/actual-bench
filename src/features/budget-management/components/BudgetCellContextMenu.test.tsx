/**
 * A group row and a month column are sets of cells. Rollover and Transfer act
 * on one category-month and have no meaning for a set, so they must not be
 * offered there - silently applying one to "whatever cell was under the
 * pointer" would be worse than not offering it.
 */
import { render, screen } from "@testing-library/react";
import { BudgetCellContextMenu } from "./BudgetCellContextMenu";

function renderMenu(overrides: Partial<Parameters<typeof BudgetCellContextMenu>[0]> = {}) {
  render(
    <BudgetCellContextMenu
      x={0}
      y={0}
      carryover={false}
      budgetMode="envelope"
      categoryBalance={0}
      scope="cell"
      onToggleCarryover={() => {}}
      onOpenTransfer={() => {}}
      onBulkAction={() => {}}
      onClose={() => {}}
      {...overrides}
    />
  );
}

describe("BudgetCellContextMenu scopes", () => {
  it("offers Transfer on a cell in envelope mode", () => {
    renderMenu({ budgetMode: "envelope" });
    expect(screen.getByText(/Transfer to Another Category/i)).toBeInTheDocument();
  });

  it("offers Rollover on a cell in tracking mode", () => {
    renderMenu({ budgetMode: "tracking" });
    expect(screen.getByText(/Enable Rollover/i)).toBeInTheDocument();
  });

  it("hides the per-cell actions for a group target", () => {
    renderMenu({ scope: "group", budgetMode: "envelope", scopeLabel: "Groceries - Mar 2026" });
    expect(screen.queryByText(/Transfer to Another Category/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Rollover/i)).not.toBeInTheDocument();
  });

  it("hides the per-cell actions for a month target", () => {
    renderMenu({ scope: "month", budgetMode: "tracking", scopeLabel: "All categories - Mar 2026" });
    expect(screen.queryByText(/Rollover/i)).not.toBeInTheDocument();
  });

  it("keeps every bulk action available in a group target", () => {
    renderMenu({ scope: "group", scopeLabel: "Groceries - Mar 2026" });
    expect(screen.getByText("Copy prior year same month")).toBeInTheDocument();
    expect(screen.getByText("Set to zero")).toBeInTheDocument();
  });

  it("says what it will act on, and how many cells", () => {
    renderMenu({ scope: "month", scopeLabel: "All categories - Mar 2026", scopeCellCount: 45 });
    expect(screen.getByText("All categories - Mar 2026")).toBeInTheDocument();
    expect(screen.getByText("45 cells")).toBeInTheDocument();
  });

  it("shows no scope banner for a single cell", () => {
    renderMenu({ scope: "cell", scopeLabel: "should not render" });
    expect(screen.queryByText("should not render")).not.toBeInTheDocument();
  });
});
