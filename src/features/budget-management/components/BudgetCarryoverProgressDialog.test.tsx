import { render, screen } from "@testing-library/react";
import { BudgetCarryoverProgressDialog } from "./BudgetCarryoverProgressDialog";
import { useCarryoverToggle } from "../hooks/useCarryoverToggle";
import type { CarryoverToggleInput } from "../hooks/useCarryoverToggle";

jest.mock("../hooks/useCarryoverToggle", () => ({
  useCarryoverToggle: jest.fn(),
}));

const mockUseCarryoverToggle = useCarryoverToggle as jest.MockedFunction<typeof useCarryoverToggle>;

describe("BudgetCarryoverProgressDialog", () => {
  afterEach(() => {
    mockUseCarryoverToggle.mockReset();
    jest.restoreAllMocks();
  });

  it("surfaces rejected toggle attempts through the failure UI without retrying on rerender", async () => {
    const error = new Error("No active connection");
    const run = jest.fn().mockRejectedValue(error);
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    mockUseCarryoverToggle.mockReturnValue({
      run,
      isPending: false,
      progress: { completed: 0, total: 0 },
    });

    const request: CarryoverToggleInput = {
      categoryIds: ["cat-1"],
      months: ["2026-01", "2026-02"],
      newValue: true,
    };

    const { rerender } = render(
      <BudgetCarryoverProgressDialog request={request} onClose={jest.fn()} />
    );

    expect(await screen.findByText("Rollover update failed")).toBeInTheDocument();
    expect(screen.getByText("2 months could not be updated.")).toBeInTheDocument();
    expect(screen.getAllByText("No active connection")).toHaveLength(2);
    expect(consoleError).toHaveBeenCalledWith("Carryover toggle failed", error);

    rerender(<BudgetCarryoverProgressDialog request={request} onClose={jest.fn()} />);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("calls run with all category-month pairs when multi-category request is given", async () => {
    const run = jest.fn().mockResolvedValue([
      { categoryId: "cat-1", month: "2026-01", status: "success" },
      { categoryId: "cat-2", month: "2026-01", status: "success" },
    ]);

    mockUseCarryoverToggle.mockReturnValue({
      run,
      isPending: false,
      progress: { completed: 0, total: 0 },
    });

    const request: CarryoverToggleInput = {
      categoryIds: ["cat-1", "cat-2"],
      months: ["2026-01"],
      newValue: true,
    };

    render(
      <BudgetCarryoverProgressDialog
        request={request}
        onClose={jest.fn()}
      />
    );

    expect(await screen.findByText("Rollover enabled")).toBeInTheDocument();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(request);
    expect(screen.getByText(/2 category-months/)).toBeInTheDocument();
  });

  it("shows multi-category failure list with categoryId and month", async () => {
    const error = new Error("PATCH failed");
    const run = jest.fn().mockRejectedValue(error);
    jest.spyOn(console, "error").mockImplementation(() => {});

    mockUseCarryoverToggle.mockReturnValue({
      run,
      isPending: false,
      progress: { completed: 0, total: 0 },
    });

    const request: CarryoverToggleInput = {
      categoryIds: ["cat-1", "cat-2"],
      months: ["2026-01"],
      newValue: false,
    };

    render(
      <BudgetCarryoverProgressDialog request={request} onClose={jest.fn()} />
    );

    expect(await screen.findByText("Rollover update failed")).toBeInTheDocument();
    expect(screen.getByText("cat-1: 2026-01")).toBeInTheDocument();
    expect(screen.getByText("cat-2: 2026-01")).toBeInTheDocument();
  });
});
