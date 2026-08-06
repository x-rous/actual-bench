import { render, screen } from "@testing-library/react";
import { BudgetMeter, meterStatus } from "./BudgetMeter";
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

  it("embedded: hides the visible remaining text but keeps it in the accessible name", () => {
    render(
      <BudgetMeter
        model={model({ filled: 70_000, remaining: -10_000, remainingLabel: "over" })}
        embedded
      />,
    );
    // The redundant remaining text is not shown (the box's headline states it)…
    expect(screen.queryByText(/100\.00 over/)).not.toBeInTheDocument();
    // …but it stays in the progressbar's accessible name for screen readers.
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toMatch(/100\.00 over/);
    // The "spent of total" caption still renders (whole dollars on the bar).
    expect(screen.getByText(/Spent 700 of 600/)).toBeInTheDocument();
  });
});

describe("meterStatus (summary-box headline)", () => {
  it("phrases tracking-expense variance as under/over budget", () => {
    expect(meterStatus(model({ variant: "expense", remaining: 8_000 }))).toEqual({
      label: "Under budget by",
      value: 8_000,
      tone: "positive",
    });
    expect(meterStatus(model({ variant: "expense", remaining: -8_000 }))).toEqual({
      label: "Over budget by",
      value: 8_000,
      tone: "negative",
    });
    expect(meterStatus(model({ variant: "expense", remaining: 0 }))).toEqual({
      label: "On budget",
      value: null,
      tone: "neutral",
    });
  });

  it("phrases the envelope meter as left-to-spend / overspent", () => {
    expect(meterStatus(model({ variant: "envelope", remaining: 15_000 }))).toMatchObject({
      label: "Left to spend",
      tone: "positive",
    });
    expect(meterStatus(model({ variant: "envelope", remaining: -5_000 }))).toMatchObject({
      label: "Overspent",
      tone: "negative",
    });
  });

  it("phrases income as ahead / left to receive / on plan", () => {
    expect(meterStatus(model({ variant: "income", remaining: -3_000 }))).toMatchObject({
      label: "Ahead by",
      tone: "positive",
    });
    expect(meterStatus(model({ variant: "income", remaining: 3_000 }))).toMatchObject({
      label: "Left to receive",
    });
    expect(meterStatus(model({ variant: "income", remaining: 0 }))).toMatchObject({
      label: "On plan",
      value: null,
    });
  });
});
