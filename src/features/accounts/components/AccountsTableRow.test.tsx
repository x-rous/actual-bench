import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AccountsTableRow } from "./AccountsTableRow";

function rowProps(): React.ComponentProps<typeof AccountsTableRow> {
  return {
    row: {
      entity: { id: "draft", name: "Wallet", offBudget: false, closed: false },
      original: null, isNew: true, isUpdated: false, isDeleted: false, validationErrors: {},
    },
    groups: [{ id: "g1", name: "Assets" }],
    groupClasses: new Map(),
    canAssignGroups: true,
    highlightedId: null, isRowSelected: false, isNameSelected: false,
    isNameEditing: false, isDuplicate: false, hasNote: false, ruleCount: 0,
    canSetClass: true, isAnotherCellEditing: false,
    onAssignGroup: jest.fn(), onRequestNewGroup: jest.fn(), onSetClass: jest.fn(),
    onToggleSelect: jest.fn(), onSelectNameCell: jest.fn(), onStartEditingName: jest.fn(),
    onDoneName: jest.fn(), onToggleNewBudgetType: jest.fn(), onSetInitialBalance: jest.fn(),
    onOpenRules: jest.fn(), onClearSaveError: jest.fn(), onRevert: jest.fn(),
    onRequestClose: jest.fn(), onReopen: jest.fn(), onRequestDelete: jest.fn(), onInspect: jest.fn(),
  };
}

function table(props: React.ComponentProps<typeof AccountsTableRow>) {
  return <table><tbody><AccountsTableRow {...props} /></tbody></table>;
}

describe("account row group availability", () => {
  it("updates group eligibility when another group's class changes", async () => {
    const props = rowProps();
    const { rerender } = render(table(props));
    fireEvent.click(screen.getByRole("button", { name: "Group of Wallet: No group. Change group" }));
    expect(await screen.findByRole("option", { name: "Assets" })).not.toHaveAttribute("aria-disabled", "true");

    rerender(table({ ...props, groupClasses: new Map([["g1", "property"]]) }));
    expect(await screen.findByRole("option", { name: "Assets Requires off-budget accounts" })).toHaveAttribute("aria-disabled", "true");
  });

  it("updates the group control when assignment availability changes", () => {
    const props = rowProps();
    const { rerender } = render(table(props));
    const button = () => screen.queryByRole("button", { name: "Group of Wallet: No group. Change group" });
    expect(button()).toBeInTheDocument();
    rerender(table({ ...props, canAssignGroups: false }));
    expect(button()).not.toBeInTheDocument();
    rerender(table(props));
    expect(button()).toBeInTheDocument();
  });
});
