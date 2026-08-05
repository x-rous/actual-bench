import { render, screen } from "@testing-library/react";
import { BudgetMeter } from "./BudgetMeter";
import type { BudgetMeterModel } from "../../lib/budgetDetailsMetrics";

function model(overrides: Partial<BudgetMeterModel> = {}): BudgetMeterModel {
  return {
    total: 60_000,
    filled: 45_000,
    remaining: 15_000,
    filledLabel: "Spent",
    totalLabel: "Available",
    remainingLabel: "left",
    variant: "expense",
    ...overrides,
  };
}

describe("BudgetMeter", () => {
  it("exposes an accessible progressbar with the spent/total values", () => {
    render(<BudgetMeter model={model()} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "60000");
    expect(bar).toHaveAttribute("aria-valuenow", "45000");
    // Caption carries the numbers and the remaining status (never colour-only).
    expect(bar.getAttribute("aria-label")).toMatch(/150\.00 left/);
  });

  it("shows an 'over' remainder when the balance is negative", () => {
    render(<BudgetMeter model={model({ filled: 70_000, remaining: -10_000, remainingLabel: "over" })} />);
    expect(screen.getByText(/100\.00 over/)).toBeInTheDocument();
  });
});
