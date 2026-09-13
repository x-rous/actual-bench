"use client";

import { fireEvent, render, screen } from "@testing-library/react";
import type { PossiblePair } from "@/lib/reconciliation/session/possiblePairs";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { PossiblePairsDialog } from "./PossiblePairsDialog";

const row: StatementRow = {
  id: "s1",
  sourceRowNumber: 1,
  postedDate: "2026-08-15",
  amount: -5442,
  importedPayee: "Danube-D- JEDDAH SAU SAR53.45",
  raw: {},
  fingerprint: "fp-s1",
};

const transaction: ActualTransactionSnapshot = {
  id: "t1",
  accountId: "acct-1",
  date: "2026-08-13",
  amount: -5207,
  payeeId: null,
  payeeName: null,
  importedPayee: null,
  categoryId: null,
  categoryName: null,
  notes: "#API Danube-D-8505",
  cleared: true,
  reconciled: false,
  importedId: null,
  transferId: null,
  scheduleId: null,
  isParent: false,
  isChild: false,
  parentId: null,
  splitLines: [],
};

const items = new Map<string, ReconciliationItem>([
  ["i-s", { id: "i-s", statementRowIds: ["s1"], actualTransactionIds: [], disposition: "create",
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" } }],
  ["i-t", { id: "i-t", statementRowIds: [], actualTransactionIds: ["t1"], disposition: "delete",
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" } }],
]);

const pair: PossiblePair = {
  statementItemId: "i-s",
  actualItemId: "i-t",
  similarity: 0.667,
  amountDifference: 235,
  dayGap: -2,
};

function renderDialog(over: Partial<React.ComponentProps<typeof PossiblePairsDialog>> = {}) {
  const props = {
    open: true,
    pairs: [pair],
    items,
    statementRows: new Map([["s1", row]]),
    transactions: new Map([["t1", transaction]]),
    onLink: jest.fn(),
    onDismiss: jest.fn(),
    onBackToRows: jest.fn(),
    onContinue: jest.fn(),
    ...over,
  };
  render(<PossiblePairsDialog {...props} />);
  return props;
}

describe("the last look before review", () => {
  it("shows both sides, with the dates and amounts that differ", () => {
    renderDialog();

    // Statement left, Actual right - the shape the grid already uses.
    expect(screen.getByText("Danube-D- JEDDAH SAU SAR53.45")).toBeInTheDocument();
    expect(screen.getByText("#API Danube-D-8505")).toBeInTheDocument();
    expect(screen.getByText("-54.42")).toBeInTheDocument();
    expect(screen.getByText("-52.07")).toBeInTheDocument();
  });

  it("says why it is asking, in the terms the reader weighs", () => {
    renderDialog();
    expect(screen.getByText(/2 days apart · 2\.35 apart/)).toBeInTheDocument();
  });

  it("offers the link, and leaving it alone", () => {
    const props = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /These are the same transaction/ }));
    expect(props.onLink).toHaveBeenCalledWith("i-s", "i-t");

    fireEvent.click(screen.getByRole("button", { name: "Leave them" }));
    expect(props.onDismiss).toHaveBeenCalledWith(pair);
  });

  it("never blocks", () => {
    /*
     * Replacing a transaction whose amount cannot be corrected in place,
     * clearing a genuine duplicate the statement also carries, and retrying a
     * partial apply are all reasons to mean both halves. A gate that refuses
     * them would be wrong, and a gate that is wrong gets dismissed by habit.
     */
    const props = renderDialog();
    const carryOn = screen.getByRole("button", { name: "Continue to review" });

    expect(carryOn).not.toBeDisabled();
    fireEvent.click(carryOn);
    expect(props.onContinue).toHaveBeenCalled();
  });

  it("says so rather than emptying out when everything has been settled", () => {
    // Linking the last pair must not leave a dialog full of nothing, and must
    // not navigate on its own either - the user presses Continue.
    const props = renderDialog({ pairs: [] });

    expect(screen.getByText("Nothing left to check")).toBeInTheDocument();
    expect(props.onContinue).not.toHaveBeenCalled();
  });
});
