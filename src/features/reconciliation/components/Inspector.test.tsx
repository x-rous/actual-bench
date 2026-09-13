"use client";

import { render, screen } from "@testing-library/react";
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
