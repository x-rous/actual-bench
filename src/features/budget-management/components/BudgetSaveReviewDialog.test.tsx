import { fireEvent, render, screen } from "@testing-library/react";
import { BudgetSaveReviewDialog } from "./BudgetSaveReviewDialog";
import { LARGE_CHANGE_THRESHOLD } from "../lib/budgetValidation";
import type { BudgetCellKey, StagedBudgetEdit } from "../types";

const edits: Record<BudgetCellKey, StagedBudgetEdit> = {
  "2026-04:cat-1": {
    month: "2026-04",
    categoryId: "cat-1",
    nextBudgeted: LARGE_CHANGE_THRESHOLD + 1,
    previousBudgeted: 0,
    source: "manual",
  },
  "2026-05:cat-2": {
    month: "2026-05",
    categoryId: "cat-2",
    nextBudgeted: 5000,
    previousBudgeted: 7000,
    source: "paste",
  },
};

describe("BudgetSaveReviewDialog", () => {
  it("shows a compact month summary before confirmation", () => {
    render(
      <BudgetSaveReviewDialog
        edits={edits}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />
    );

    expect(screen.getByText("Review save summary")).toBeInTheDocument();
    expect(screen.getAllByText("Changes")).toHaveLength(2); // summary card + table column header
    expect(screen.getByText("Months")).toBeInTheDocument();
    expect(screen.getAllByText("Net")).toHaveLength(2);
    expect(screen.getByText("Apr 2026")).toBeInTheDocument();
    expect(screen.getByText("May 2026")).toBeInTheDocument();
    expect(screen.queryByText("Large")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText("cat-1")).not.toBeInTheDocument();
  });

  it("passes the skip-review checkbox value on confirm", () => {
    const onConfirm = jest.fn();
    render(
      <BudgetSaveReviewDialog
        edits={edits}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByText("Skip review next time"));
    fireEvent.click(screen.getByRole("button", { name: "Save 2 changes" }));

    expect(onConfirm).toHaveBeenCalledWith(true);
  });
});
