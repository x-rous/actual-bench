"use client";

import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ActualTransactionSnapshot, ReconciliationItem, StatementRow } from "@/lib/reconciliation/types";
import { correctAmountFromStatement, resolveToTransaction } from "@/lib/reconciliation/session/build";
import { GroupMatchingView } from "./GroupMatchingView";

const base: ActualTransactionSnapshot = {
  id: "t1", accountId: "a1", date: "2026-07-04", amount: -1000,
  payeeId: "p1", payeeName: "Cafe", importedPayee: null, categoryId: null, categoryName: null,
  notes: "Reference one", cleared: true, reconciled: false, importedId: null, transferId: null, scheduleId: null,
  isParent: false, isChild: false, parentId: null, splitLines: [],
};
const transactions = new Map([["t1", base], ["t2", { ...base, id: "t2", date: "2026-07-05", amount: -900, notes: "Reference two" }]]);
const statementRows = new Map(["s1", "s2"].map((id): [string, StatementRow] => [id, {
  id, sourceRowNumber: 1, postedDate: "2026-07-04", amount: -1000, importedPayee: id,
  raw: {}, fingerprint: id,
}]));
const initial: ReconciliationItem[] = ["s1", "s2"].map((id) => ({ id,
  statementRowIds: [id], actualTransactionIds: ["t1", "t2"], disposition: "unresolved",
  guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
}));

function renderGroup(initialItems = initial) {
  const onPair = jest.fn();
  const onClose = jest.fn();
  function Harness() {
    const [items, setItems] = useState(initialItems);
    return <GroupMatchingView group={{ itemIds: ["s1", "s2"], transactionIds: ["t1", "t2"] }}
      items={items} statementRows={statementRows} transactions={transactions} payees={[]} categories={[]}
      onClose={onClose} onRestoreItems={setItems} evidenceFor={() => ["Same amount"]}
      onUseCandidate={(itemId, transactionId) => {
        onPair(itemId, transactionId);
        setItems((previous) => resolveToTransaction({ items: previous, itemId, transactionId,
          transactions, transfersReported: true, makeId: () => "released" }).map((item) => item.id === itemId
            ? correctAmountFromStatement({ item, statementRow: statementRows.get(item.statementRowIds[0]), transaction: transactions.get(item.actualTransactionIds[0]) })
            : item));
      }} onDisposition={() => {}} onCorrectAmount={() => {}} onStage={() => {}} onUnstage={() => {}} />;
  }
  render(<Harness />);
  return { onPair, onClose };
}

it("selects without deciding, explicitly pairs, prunes globally and restores relationships with undo", () => {
  const { onPair } = renderGroup();
  const cell = () => screen.getByRole("button", { name: "Compare s1 with Cafe -10.00 on 2026-07-04" });
  fireEvent.click(cell());
  expect(onPair).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use this match" }));
  expect(onPair).toHaveBeenCalledWith("s1", "t1");
  expect(screen.queryByRole("complementary", { name: "Match details" })).not.toBeInTheDocument();
  expect(screen.getByText("1 bank rows left")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Compare s2 with Cafe -10.00 on 2026-07-04" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Compare s2 with Cafe -9.00 on 2026-07-05" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undo last pairing" }));
  expect(screen.getByText("2 bank rows left")).toBeInTheDocument();
  expect(cell()).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Compare s2 with Cafe -10.00 on 2026-07-04" })).toBeInTheDocument();
});

it("shows paired transactions in the reconciliation table and closes the panel after the last confirmation", () => {
  const { onPair, onClose } = renderGroup();
  expect(screen.getByRole("button", { name: "Back to all rows" })).not.toHaveClass("bg-primary");
  expect(screen.getByText("Reference one")).toBeInTheDocument();
  expect(screen.getByText("Reference two")).toBeInTheDocument();
  expect(screen.getAllByText("Same day")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Compare s1 with Cafe -10.00 on 2026-07-04" }));
  expect(screen.getAllByText("Same day")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Use this match" }));
  const firstPaired = screen.getByRole("table", { name: "Paired bank and Actual transactions" });
  expect(within(firstPaired).getByText("s1")).toBeInTheDocument();
  expect(within(firstPaired).getByText("Reference one")).toBeInTheDocument();
  expect(within(firstPaired).queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.queryByRole("complementary", { name: "Match details" })).not.toBeInTheDocument();
  // The final remaining pair still requires confirmation.
  expect(onPair).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Compare s2 with Cafe -9.00 on 2026-07-05" }));
  fireEvent.click(screen.getByRole("button", { name: "Use this match" }));
  expect(onPair).toHaveBeenCalledTimes(2);
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Back to all rows" })).toHaveClass("bg-primary");
  expect(screen.getByRole("status")).toHaveTextContent("The bank rows in this group are decided.");
  expect(screen.getByRole("status").parentElement).toBe(screen.getByRole("heading", { name: "Paired" }).parentElement);
  expect(screen.queryByRole("complementary", { name: "Match details" })).not.toBeInTheDocument();
  const paired = screen.getByRole("table", { name: "Paired bank and Actual transactions" });
  const correctedRow = within(paired).getByText("Reference two").closest("tr")!;
  expect(within(correctedRow).getByText("s2")).toBeInTheDocument();
  expect(within(correctedRow).getByText("Cafe")).toBeInTheDocument();
  expect(within(correctedRow).getByText("-10.00")).toBeInTheDocument();
  expect(within(correctedRow).getByText("-9.00")).toBeInTheDocument();
  expect(within(correctedRow).getByText("Will fix amount")).toBeInTheDocument();
  expect(within(paired).getAllByRole("columnheader", { name: "Date" })).toHaveLength(2);
  expect(within(paired).getAllByRole("columnheader", { name: "Amount" })).toHaveLength(2);
  fireEvent.click(correctedRow);
  expect(screen.getByRole("heading", { level: 3, name: "Will fix amount" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close match details" }));
  expect(screen.getByRole("button", { name: "Back to all rows" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undo last pairing" }));
  expect(screen.getByText("1 bank rows left")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Back to all rows" })).not.toHaveClass("bg-primary");
  expect(screen.getByRole("button", { name: "Compare s2 with Cafe -9.00 on 2026-07-05" })).toBeInTheDocument();
  expect(within(screen.getByRole("table", { name: "Paired bank and Actual transactions" })).queryByText("Reference two")).not.toBeInTheDocument();
  expect(screen.queryByRole("complementary", { name: "Match details" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back to all rows" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("hides released candidates that no pending bank row can use and restores them with undo", () => {
  renderGroup([initial[0], { ...initial[1], actualTransactionIds: ["t2"] }]);
  fireEvent.click(screen.getByRole("button", { name: "Compare s1 with Cafe -9.00 on 2026-07-05" }));
  fireEvent.click(screen.getByRole("button", { name: "Use this match" }));
  const matrix = screen.getByRole("table", { name: "Bank rows and their existing Actual candidates" });
  expect(within(matrix).queryByText("Reference one")).not.toBeInTheDocument();
  expect(within(matrix).queryByText("Reference two")).not.toBeInTheDocument();
  expect(within(matrix).getByText("s2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undo last pairing" }));
  expect(within(matrix).getByText("Reference one")).toBeInTheDocument();
  expect(within(matrix).getByText("Reference two")).toBeInTheDocument();
});
