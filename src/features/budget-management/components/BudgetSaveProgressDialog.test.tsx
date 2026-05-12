import { render, screen } from "@testing-library/react";
import { BudgetSaveProgressDialog } from "./BudgetSaveProgressDialog";
import { useBudgetSave } from "../hooks/useBudgetSave";
import type { BudgetCellKey, StagedBudgetEdit } from "../types";

jest.mock("../hooks/useBudgetSave", () => ({
  useBudgetSave: jest.fn(),
}));

const mockUseBudgetSave = useBudgetSave as jest.MockedFunction<typeof useBudgetSave>;

const edits: Record<BudgetCellKey, StagedBudgetEdit> = {
  "2026-04:cat-1": {
    month: "2026-04",
    categoryId: "cat-1",
    nextBudgeted: 12000,
    previousBudgeted: 10000,
    source: "manual",
  },
  "2026-05:cat-2": {
    month: "2026-05",
    categoryId: "cat-2",
    nextBudgeted: 5000,
    previousBudgeted: 7000,
    source: "manual",
  },
};

describe("BudgetSaveProgressDialog", () => {
  afterEach(() => {
    mockUseBudgetSave.mockReset();
    jest.restoreAllMocks();
  });

  it("surfaces rejected save attempts through the failure UI without retrying on rerender", async () => {
    const error = new Error("No active connection");
    const save = jest.fn().mockRejectedValue(error);
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    mockUseBudgetSave.mockReturnValue({
      save,
      isSaving: false,
      progress: { completed: 0, total: 0 },
    });

    const { rerender } = render(
      <BudgetSaveProgressDialog edits={edits} onClose={jest.fn()} />
    );

    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    expect(screen.getByText("2 changes could not be saved.")).toBeInTheDocument();
    expect(screen.getAllByText("No active connection")).toHaveLength(2);
    expect(consoleError).toHaveBeenCalledWith("Budget save failed", error);

    rerender(<BudgetSaveProgressDialog edits={edits} onClose={jest.fn()} />);

    expect(save).toHaveBeenCalledTimes(1);
  });
});
