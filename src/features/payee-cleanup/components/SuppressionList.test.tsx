import { fireEvent, render, screen } from "@testing-library/react";
import { SuppressionList } from "./SuppressionList";

describe("SuppressionList", () => {
  it("labels each dismissal with the workflow that produced it", () => {
    render(
      <SuppressionList
        suppressions={[
          {
            id: "duplicate",
            budgetSyncId: "budget-1",
            kind: "not-duplicates",
            payeeIds: ["payee-1", "payee-2"],
            normalizedNames: ["market one", "market 1"],
            detectorIds: ["normalized"],
            createdAt: "2026-09-18T00:00:00.000Z",
          },
          {
            id: "rule-gap",
            budgetSyncId: "budget-1",
            kind: "rule-not-needed",
            payeeIds: ["payee-3"],
            normalizedNames: ["salary"],
            detectorIds: ["rule-gap"],
            createdAt: "2026-09-18T00:00:00.000Z",
          },
          {
            id: "affix",
            budgetSyncId: "budget-1",
            kind: "rejected-affix",
            payeeIds: [],
            normalizedNames: ["store"],
            detectorIds: ["corpus-suffix"],
            createdAt: "2026-09-18T00:00:00.000Z",
          },
        ]}
        totalCount={3}
        onUndo={jest.fn()}
        onClearAll={jest.fn()}
      />
    );

    expect(screen.getByText("Dismissed item")).toBeInTheDocument();
    expect(screen.getByText("Dismissed from")).toBeInTheDocument();
    expect(screen.getByText("Duplicate payees")).toBeInTheDocument();
    expect(screen.getByText("Payees needing rules")).toBeInTheDocument();
    expect(screen.getByText("Payee name pattern")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("states that Clear all includes dismissals hidden by search", () => {
    const onClearAll = jest.fn();
    render(
      <SuppressionList
        suppressions={[
          {
            id: "duplicate",
            budgetSyncId: "budget-1",
            kind: "not-duplicates",
            payeeIds: ["payee-1", "payee-2"],
            normalizedNames: ["market one", "market 1"],
            detectorIds: ["normalized"],
            createdAt: "2026-09-18T00:00:00.000Z",
          },
        ]}
        totalCount={4}
        filtered
        onUndo={jest.fn()}
        onClearAll={onClearAll}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^clear all$/i }));
    expect(
      screen.getByText(/Clear all 4 dismissals, including hidden matches\?/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^clear all$/i }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
