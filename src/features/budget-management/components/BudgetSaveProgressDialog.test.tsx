import { fireEvent, render, screen } from "@testing-library/react";
import { BudgetSaveProgressDialog } from "./BudgetSaveProgressDialog";
import { BudgetBatchError, useBudgetSave } from "../hooks/useBudgetSave";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import type { BudgetCellKey, StagedBudgetEdit } from "../types";

jest.mock("../hooks/useBudgetSave", () => ({
  BudgetBatchError: jest.requireActual("../hooks/useBudgetSave").BudgetBatchError,
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

  it("lists a failed hold with a rejected budget batch and retries it", async () => {
    const hold = { month: "2026-04", previousAmount: 0, nextAmount: 300, saveError: "short" };
    useBudgetEditsStore.setState({ edits, holds: { "2026-04": hold } });
    const save = jest
      .fn()
      .mockRejectedValueOnce(
        new BudgetBatchError(new Error("batch failed"), [
          { month: "2026-04", categoryId: "", status: "error", message: "short" },
        ])
      )
      .mockResolvedValueOnce([]);
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockUseBudgetSave.mockReturnValue({
      save,
      isSaving: false,
      progress: { completed: 0, total: 0 },
    });

    render(<BudgetSaveProgressDialog edits={edits} holds={{ "2026-04": hold }} onClose={jest.fn()} />);

    expect(await screen.findByText("3 changes could not be saved.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));

    await screen.findByText("All changes saved");
    expect(save).toHaveBeenLastCalledWith(edits, { "2026-04": hold });
    useBudgetEditsStore.getState().discardAll();
  });
});
