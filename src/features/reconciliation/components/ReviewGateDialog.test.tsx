"use client";

import { fireEvent, render, screen } from "@testing-library/react";
import type { PossiblePair } from "@/lib/reconciliation/session/possiblePairs";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { ReviewGateDialog } from "./ReviewGateDialog";

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

function renderDialog(over: Partial<React.ComponentProps<typeof ReviewGateDialog>> = {}) {
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
    undecided: { statement: 0, actual: 0 },
    ...over,
  };
  render(<ReviewGateDialog {...props} />);
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
    const carryOn = screen.getByRole("button", { name: "Review anyway" });

    expect(carryOn).not.toBeDisabled();
    fireEvent.click(carryOn);
    expect(props.onContinue).toHaveBeenCalled();
  });

  it("still opens for rows left undecided when no pair is outstanding", () => {
    /*
     * Undecided rows are safe - nothing is written for them - so this informs
     * rather than blocks. The two sides are named separately because they do
     * not weigh the same: a statement row not recorded is worth going back for,
     * a transaction the statement never mentioned is not.
     */
    renderDialog({ pairs: [], undecided: { statement: 8, actual: 4 } });

    // Read off the whole section: the sentence is assembled from several nodes,
    // and what matters is what the user reads, not how it is spliced.
    const said = screen.getByRole("dialog").textContent ?? "";

    // The loss first, in the words someone would use: a count of undecided rows
    // is not a reason to go back, eight missing bank transactions is.
    expect(said).toContain("8 of your bank transactions won't be added");
    expect(said).toContain("leaves them out of your budget");
    // And the half that is not a loss, said so rather than counted in.
    expect(said).toContain("Actual already has that your statement didn't mention");
    expect(screen.getByRole("button", { name: "Review anyway" })).not.toBeDisabled();
  });

  it("says nothing about undecided rows when there are none", () => {
    renderDialog({ undecided: { statement: 0, actual: 0 } });
    const said = screen.getByRole("dialog").textContent ?? "";
    expect(said).not.toContain("won't be added");
    expect(said).not.toContain("no decision");
  });

  it("does not claim a loss when only Actual-side rows are open", () => {
    // Nothing is lost by leaving a transaction the statement never mentioned,
    // so the heading must not say otherwise.
    renderDialog({ pairs: [], undecided: { statement: 0, actual: 3 } });

    const said = screen.getByRole("dialog").textContent ?? "";
    expect(said).not.toContain("won't be added");
    expect(said).toContain("3 rows still have no decision.");
  });

});
