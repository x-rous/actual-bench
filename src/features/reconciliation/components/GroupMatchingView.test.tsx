"use client";

import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ActualTransactionSnapshot, ReconciliationItem, StatementRow } from "@/lib/reconciliation/types";
import { resolveToTransaction } from "@/lib/reconciliation/session/build";
import { GroupMatchingView } from "./GroupMatchingView";

const base: ActualTransactionSnapshot = {
  id: "t1", accountId: "a1", date: "2026-07-04", amount: -1000,
  payeeId: "p1", payeeName: "Cafe", importedPayee: null, categoryId: null, categoryName: null,
  notes: null, cleared: true, reconciled: false, importedId: null, transferId: null, scheduleId: null,
  isParent: false, isChild: false, parentId: null, splitLines: [],
};
const transactions = new Map([["t1", base], ["t2", { ...base, id: "t2", date: "2026-07-05" }]]);
const statementRows = new Map(["s1", "s2"].map((id): [string, StatementRow] => [id, {
  id, sourceRowNumber: 1, postedDate: "2026-07-04", amount: -1000, importedPayee: id,
  raw: {}, fingerprint: id,
}]));
const initial: ReconciliationItem[] = ["s1", "s2"].map((id) => ({ id,
  statementRowIds: [id], actualTransactionIds: ["t1", "t2"], disposition: "unresolved",
  guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
}));

it("selects without deciding, explicitly pairs, prunes globally and restores relationships with undo", () => {
  const onPair = jest.fn();
  function Harness() {
    const [items, setItems] = useState(initial);
    return <GroupMatchingView group={{ itemIds: ["s1", "s2"], transactionIds: ["t1", "t2"] }}
      items={items} statementRows={statementRows} transactions={transactions} payees={[]} categories={[]}
      onClose={() => {}} onRestoreItems={setItems} evidenceFor={() => ["Same amount"]}
      onUseCandidate={(itemId, transactionId) => {
        onPair(itemId, transactionId);
        setItems((previous) => resolveToTransaction({ items: previous, itemId, transactionId,
          transactions, transfersReported: true, makeId: () => "released" }));
      }} onDisposition={() => {}} onCorrectAmount={() => {}} onStage={() => {}} onUnstage={() => {}} />;
  }
  render(<Harness />);
  const cell = () => screen.getByRole("button", { name: "Compare s1 with Cafe -10.00 on 2026-07-04" });
  fireEvent.click(cell());
  expect(onPair).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use this match" }));
  expect(onPair).toHaveBeenCalledWith("s1", "t1");
  expect(screen.getByText("1 bank rows left")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Compare s2 with Cafe -10.00 on 2026-07-04" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Compare s2 with Cafe -10.00 on 2026-07-05" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undo last pairing" }));
  expect(screen.getByText("2 bank rows left")).toBeInTheDocument();
  expect(cell()).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Compare s2 with Cafe -10.00 on 2026-07-04" })).toBeInTheDocument();
});
