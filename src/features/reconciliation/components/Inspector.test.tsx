"use client";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { REASON } from "@/lib/reconciliation/session/build";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { Inspector } from "./Inspector";

const row: StatementRow = {
  id: "s1",
  sourceRowNumber: 1,
  postedDate: "2026-08-15",
  amount: -1730,
  importedPayee: "DANUBE Ma MAKKAH SAU SAR16.99",
  raw: {},
  fingerprint: "fp-s1",
};

const transaction: ActualTransactionSnapshot = {
  id: "t1",
  accountId: "acct-1",
  date: "2026-08-15",
  amount: -1663,
  payeeId: null,
  payeeName: null,
  importedPayee: null,
  categoryId: null,
  categoryName: null,
  notes: "#API DANUBE Makkah D - 8501",
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

const statementOnly: ReconciliationItem = {
  id: "i-s",
  statementRowIds: ["s1"],
  actualTransactionIds: [],
  disposition: "unresolved",
  reasonCode: REASON.noActualCandidate,
  guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
};

function renderInspector() {
  render(
    <Inspector
      item={statementOnly}
      statementRow={row}
      transactions={[]}
      payees={[]}
      categories={[]}
      onClose={() => {}}
      onDisposition={() => {}}
      onUseCandidate={() => {}}
      onCorrectAmount={() => {}}
      onStage={() => {}}
      onUnstage={() => {}}
      possiblePartner={{
        pair: {
          statementItemId: "i-s",
          actualItemId: "i-t",
          similarity: 0.5,
          amountDifference: 67,
          dayGap: 0,
        },
        row,
        transaction,
      }}
      onLinkPossible={() => {}}
    />
  );
}

/*
 * The first version of this section showed only the difference - "0.67 apart" -
 * while the panel above it showed whichever row happened to be selected. So a
 * user on the statement-only row was asked to confirm a pairing without ever
 * being shown the other half of it, which is not a question anyone can answer.
 */
describe("being asked whether two rows are the same transaction", () => {
  it("shows the transaction it is asking about, not just how far apart it is", () => {
    renderInspector();

    // The Actual side is not the selected row, and would otherwise be absent.
    expect(screen.getByText("#API DANUBE Makkah D - 8501")).toBeInTheDocument();
    expect(screen.getByText("-16.63")).toBeInTheDocument();
  });

  it("stacks the two like the candidate list, each labelled", () => {
    renderInspector();

    // Two blocks to choose between, in the shape choosing already takes here -
    // not a compare table, which is the panel's vocabulary for a settled pair.
    expect(screen.getByText("From the statement")).toBeInTheDocument();
    expect(screen.getByText("In Actual")).toBeInTheDocument();
    expect(screen.getByText("-17.30")).toBeInTheDocument();
  });

  it("says what separates them once, rather than marking every line", () => {
    renderInspector();
    expect(screen.getByText(/Same day · 0\.67 apart/)).toBeInTheDocument();
  });

  it("offers the confirmation", () => {
    renderInspector();
    expect(
      screen.getByRole("button", { name: /These are the same transaction/ })
    ).toBeInTheDocument();
  });
});

it("offers the statement date explicitly and exposes its staged undo", () => {
  const item: ReconciliationItem = { ...statementOnly, disposition: "matched", actualTransactionIds: ["t1"] };
  const actual = { ...transaction, date: "2026-08-13", amount: row.amount };
  const onStage = jest.fn(); const onUnstage = jest.fn();
  const props = { item, statementRow: row, transactions: [actual], payees: [], categories: [],
    onStage, onUnstage, onClose: jest.fn(), onDisposition: jest.fn(), onUseCandidate: jest.fn(), onCorrectAmount: jest.fn() };
  const view = render(<Inspector {...props} />);
  expect(onStage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Use statement date/ }));
  expect(onStage).toHaveBeenCalledWith("date", "2026-08-15");
  view.rerender(<Inspector {...props} item={{ ...item, stagedChanges: {
    date: { original: actual.date, staged: row.postedDate, source: "manual" },
  } }} />);
  fireEvent.click(screen.getByRole("button", { name: "Undo date" }));
  expect(onUnstage).toHaveBeenCalledWith("date");
  view.rerender(<Inspector {...props} item={{ ...item, guards: { ...item.guards, protectedReconciled: true } }} />);
  expect(screen.queryByRole("button", { name: /Use statement date/ })).not.toBeInTheDocument();
});

it("shows confidence in the header and keeps decisions in the footer, with date correction beside the comparison", () => {
  const actual = { ...transaction, date: "2026-08-13", amount: row.amount };
  const matched: ReconciliationItem = { ...statementOnly, disposition: "matched", actualTransactionIds: [actual.id],
    match: { type: "suggested", evidenceSource: "bench", confidence: 100, label: "high", reasons: [
      { kind: "amount", verdict: "exact" }, { kind: "date", deltaDays: -2 },
      { kind: "text", field: "payeeName", mode: "symmetric", similarity: .52 },
      { kind: "text", field: "notes", mode: "containment", similarity: 1 },
    ] } };
  render(<Inspector item={matched} statementRow={row} transactions={[actual]} payees={[]} categories={[]}
    onClose={jest.fn()} onDisposition={jest.fn()} onUseCandidate={jest.fn()} onCorrectAmount={jest.fn()}
    onStage={jest.fn()} onUnstage={jest.fn()} />);
  const summary = screen.getByRole("list", { name: "Match evidence" });
  expect(screen.getByRole("heading", { level: 3, name: "High confidence" })).toBeInTheDocument();
  expect(within(summary).getAllByRole("listitem")).toHaveLength(3);
  expect(within(summary).getByText("Notes 100% similar")).toBeInTheDocument();
  expect(within(summary).queryByText("Payee 52% similar")).not.toBeInTheDocument();
  expect(screen.queryByText("Reference")).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Comparison" })).getByRole("button", { name: "Use statement date" })).toBeInTheDocument();
  const editor = screen.getByRole("region", { name: "Resulting transaction" });
  const actions = screen.getByRole("region", { name: "Actions" });
  expect(actions.closest("footer")).not.toBeNull();
  expect(editor.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("keeps candidate comparison read-only until explicit confirmation", () => {
  const onUseCandidate = jest.fn();
  render(<Inspector item={{ ...statementOnly, actualTransactionIds: [transaction.id] }}
    statementRow={row} transactions={[transaction]} payees={[]} categories={[]} candidateSelection
    onClose={jest.fn()} onDisposition={jest.fn()} onUseCandidate={onUseCandidate} onCorrectAmount={jest.fn()}
    onStage={jest.fn()} onUnstage={jest.fn()} />);
  expect(screen.getByText("Candidate comparison")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Resulting transaction" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Use this match" }));
  expect(onUseCandidate).toHaveBeenCalledWith(transaction.id);
});

it.each([
  ["create", "Will create"], ["delete", "Will delete"], ["ignored", "Ignored"],
  ["keep", "Keep in Actual"], ["correct-amount", "Will fix amount"], ["unresolved", "Amount differs"],
] as const)("uses the current %s outcome in the header", (disposition, title) => {
  render(<Inspector item={{ ...statementOnly, disposition, actualTransactionIds: [transaction.id],
    match: { type: "suggested", evidenceSource: "bench", label: "high", confidence: 100, reasons: [] } }}
    statementRow={row} transactions={[transaction]} payees={[]} categories={[]}
    onClose={jest.fn()} onDisposition={jest.fn()} onUseCandidate={jest.fn()} onCorrectAmount={jest.fn()}
    onStage={jest.fn()} onUnstage={jest.fn()} />);
  expect(screen.getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
  expect(screen.queryByText("High confidence")).not.toBeInTheDocument();
});

it("keeps candidate choices in the body and declining them in the footer", () => {
  const onUseCandidate = jest.fn();
  render(<Inspector item={{ ...statementOnly, actualTransactionIds: ["t1", "t2"] }}
    statementRow={row} transactions={[transaction, { ...transaction, id: "t2", payeeName: "Second candidate" }]}
    payees={[]} categories={[]} onClose={jest.fn()} onDisposition={jest.fn()} onUseCandidate={onUseCandidate}
    onCorrectAmount={jest.fn()} onStage={jest.fn()} onUnstage={jest.fn()} />);
  expect(screen.getByRole("heading", { level: 3, name: "Needs pairing" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Possible matches" }).closest("footer")).toBeNull();
  const actions = screen.getByRole("region", { name: "Actions" });
  expect(actions.closest("footer")).not.toBeNull();
  expect(within(actions).queryByText("Second candidate")).not.toBeInTheDocument();
  fireEvent.click(within(actions).getByRole("button", { name: "None of these" }));
  expect(onUseCandidate).toHaveBeenCalledWith(null);
});
