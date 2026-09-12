"use client";

import { render, screen } from "@testing-library/react";
import { REASON } from "@/lib/reconciliation/session/build";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { ItemActions } from "./ItemActions";

function statementRow(): StatementRow {
  return {
    id: "s1",
    sourceRowNumber: 1,
    postedDate: "2026-08-07",
    amount: -1012,
    importedPayee: "CAREEM RIDE DUBAI SAU SAR9.94",
    raw: {},
    fingerprint: "fp-s1",
  };
}

function txn(id: string, amount: number): ActualTransactionSnapshot {
  return {
    id,
    accountId: "acct-1",
    date: "2026-08-07",
    amount,
    payeeId: null,
    payeeName: `Careem ${id}`,
    importedPayee: null,
    categoryId: null,
    categoryName: null,
    notes: "#API CAREEM RIDE",
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
}

const item: ReconciliationItem = {
  id: "i1",
  statementRowIds: ["s1"],
  actualTransactionIds: ["far", "near", "middling"],
  disposition: "unresolved",
  reasonCode: REASON.merchantCluster,
  guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
};

function renderActions(transactions: ActualTransactionSnapshot[]) {
  render(
    <ItemActions
      item={item}
      statementRow={statementRow()}
      transactions={transactions}
      onDisposition={() => {}}
      onUseCandidate={() => {}}
      onCorrectAmount={() => {}}
    />
  );
}

/*
 * These candidates are the same merchant on the same day, so the amount is the
 * only thing separating them - which is why each states its distance from the
 * statement. Leaving them in match order made the reader do the comparison the
 * list had already done.
 */
describe("choosing between candidates", () => {
  it("puts the closest amount first, whatever order they arrive in", () => {
    // Statement -10.12; gaps of 2.44, 0.38 and 1.01.
    renderActions([txn("far", -1218), txn("near", -974), txn("middling", -1113)]);

    const names = screen
      .getAllByRole("button")
      .map((button) => button.textContent ?? "")
      .filter((text) => text.includes("Careem"));

    expect(names[0]).toContain("Careem near");
    expect(names[1]).toContain("Careem middling");
    expect(names[2]).toContain("Careem far");
  });

  it("states each candidate's distance from the statement", () => {
    // The list only appears where there is a choice, so two candidates.
    renderActions([txn("near", -974), txn("far", -1218)]);

    expect(screen.getByText(/0\.38/)).toBeInTheDocument();
    expect(screen.getByText(/2\.06/)).toBeInTheDocument();
  });

  it("orders nothing when there is no statement row to measure against", () => {
    // An Actual-only row has nothing to be close to; the given order stands.
    render(
      <ItemActions
        item={{ ...item, statementRowIds: [] }}
        statementRow={undefined}
        transactions={[txn("far", -1218), txn("near", -974)]}
        onDisposition={() => {}}
        onUseCandidate={() => {}}
        onCorrectAmount={() => {}}
      />
    );

    const names = screen
      .getAllByRole("button")
      .map((button) => button.textContent ?? "")
      .filter((text) => text.includes("Careem"));
    expect(names[0]).toContain("Careem far");
  });
});
