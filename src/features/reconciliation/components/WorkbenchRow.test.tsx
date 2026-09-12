"use client";

import { render, screen } from "@testing-library/react";
import { REASON } from "@/lib/reconciliation/session/build";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { WorkbenchRow } from "./WorkbenchRow";

function statementRow(): StatementRow {
  return {
    id: "s1",
    sourceRowNumber: 1,
    postedDate: "2026-08-16",
    amount: -1455,
    importedPayee: "Jeeny Jeddah SAU SAR14.29",
    raw: {},
    fingerprint: "fp-s1",
  };
}

function txn(
  overrides: Partial<ActualTransactionSnapshot> & Pick<ActualTransactionSnapshot, "id">
): ActualTransactionSnapshot {
  return {
    accountId: "acct-1",
    date: "2026-08-16",
    amount: -1535,
    payeeId: null,
    payeeName: null,
    importedPayee: null,
    categoryId: null,
    categoryName: null,
    notes: "#API Jeeny",
    cleared: true,
    reconciled: false,
    importedId: null,
    transferId: null,
    scheduleId: null,
    isParent: false,
    isChild: false,
    parentId: null,
    splitLines: [],
    ...overrides,
  };
}

function item(overrides: Partial<ReconciliationItem> = {}): ReconciliationItem {
  return {
    id: "i1",
    statementRowIds: ["s1"],
    actualTransactionIds: ["t1"],
    disposition: "unresolved",
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
    ...overrides,
  };
}

function renderRow(
  over: Partial<ReconciliationItem>,
  transactions: ActualTransactionSnapshot[],
  contestedBy?: number
) {
  return render(
    <table>
      <tbody>
        <WorkbenchRow
          item={item(over)}
          statementRow={statementRow()}
          transactions={transactions}
          contestedBy={contestedBy}
          selected={false}
          checked={false}
          onToggleChecked={() => {}}
          onSelect={() => {}}
        />
      </tbody>
    </table>
  );
}

/*
 * A row offering several candidates is a question, and it used to be rendered as
 * an answer: the Match column said "Amount differs" however many candidates the
 * item held, while the leading candidate's date, payee, notes and amount filled
 * the Actual columns as though the pair had been settled - with the rest reduced
 * to a muted "+4" beside the payee, where it read as something about that payee
 * rather than as a count of choices (F-151f).
 */
describe("a row with several candidates", () => {
  const many = [txn({ id: "t1" }), txn({ id: "t2", amount: -1400 }), txn({ id: "t3", amount: -1360 })];

  it("puts the count in the Match column, with the decision", () => {
    renderRow({ reasonCode: REASON.merchantCluster, actualTransactionIds: ["t1", "t2", "t3"] }, many);

    expect(screen.getByText("Needs pairing")).toBeInTheDocument();
    expect(screen.getByText("3 possible matches")).toBeInTheDocument();
  });

  it("no longer hides the count beside the payee", () => {
    renderRow({ reasonCode: REASON.merchantCluster, actualTransactionIds: ["t1", "t2", "t3"] }, many);

    expect(screen.queryByText("+2")).not.toBeInTheDocument();
    expect(screen.getByText("3 candidates - choose one")).toBeInTheDocument();
  });

  it("states no amount for the Actual side while there is no answer", () => {
    // The reported symptom: a statement row of -14.55 opposite an unrelated
    // -15.35, reading as a comparison of two figures that were never a pair.
    renderRow({ reasonCode: REASON.merchantCluster, actualTransactionIds: ["t1", "t2", "t3"] }, many);

    expect(screen.getByText("-14.55")).toBeInTheDocument();
    expect(screen.queryByText("-15.35")).not.toBeInTheDocument();
    expect(screen.queryByText("#API Jeeny")).not.toBeInTheDocument();
  });

  it("calls an amount mismatch a cluster once it holds more than one", () => {
    // "Amount differs" is true of a pair, not of a choice between three.
    renderRow({ reasonCode: REASON.amountMismatch, actualTransactionIds: ["t1", "t2", "t3"] }, many);

    expect(screen.getByText("Needs pairing")).toBeInTheDocument();
    expect(screen.queryByText("Amount differs")).not.toBeInTheDocument();
  });
});

describe("a row with one candidate", () => {
  it("still says what is wrong with the pair", () => {
    renderRow({ reasonCode: REASON.amountMismatch }, [txn({ id: "t1" })]);

    expect(screen.getByText("Amount differs")).toBeInTheDocument();
    expect(screen.queryByText(/possible matches/)).not.toBeInTheDocument();
  });

  it("shows the transaction, because there is one to show", () => {
    renderRow({ reasonCode: REASON.amountMismatch }, [txn({ id: "t1" })]);

    expect(screen.getByText("-15.35")).toBeInTheDocument();
    expect(screen.getByText("#API Jeeny")).toBeInTheDocument();
  });

  it("keeps a decided row reporting its decision, not its old reason", () => {
    renderRow(
      { reasonCode: REASON.merchantCluster, disposition: "create", actualTransactionIds: [] },
      []
    );

    expect(screen.getByText("Will create")).toBeInTheDocument();
    expect(screen.queryByText("Needs pairing")).not.toBeInTheDocument();
  });
});

/*
 * A cluster row holding one candidate is still contested: several statement
 * rows are competing for that transaction. Rendering it like a settled pairing
 * put the same -9.74 opposite three different CAREEM rows, each reading as a
 * match.
 */
describe("a cluster row with a single candidate", () => {
  const one = [txn({ id: "t1", payeeName: "Careem", amount: -974 })];

  it("says the transaction is shared rather than counting candidates", () => {
    renderRow({ reasonCode: REASON.merchantCluster, actualTransactionIds: ["t1"] }, one);

    expect(screen.getByText("Needs pairing")).toBeInTheDocument();
    expect(screen.getByText("Shared with other rows")).toBeInTheDocument();
  });

  it("still shows which transaction it could be, marked as contested", () => {
    // Hiding it would be worse: this row may well be that transaction, and the
    // user needs to see the one they are being asked about.
    renderRow({ reasonCode: REASON.merchantCluster, actualTransactionIds: ["t1"] }, one, 3);

    expect(screen.getByText("Careem")).toBeInTheDocument();
    // The count, not a bare "shared" that had to be explained to the user.
    expect(screen.getByText("3 rows want this")).toBeInTheDocument();
  });

  it("falls back to plain wording when the count is not known", () => {
    renderRow({ reasonCode: REASON.merchantCluster, actualTransactionIds: ["t1"] }, one);
    expect(screen.getByText("also wanted")).toBeInTheDocument();
  });

  it("does not mark an uncontested single candidate", () => {
    renderRow({ reasonCode: REASON.amountMismatch, actualTransactionIds: ["t1"] }, one, 1);

    expect(screen.queryByText(/wants? this/)).not.toBeInTheDocument();
    expect(screen.queryByText("also wanted")).not.toBeInTheDocument();
  });
});

describe("a leftover pair whose amounts agree", () => {
  // -4.98 against -4.98 was reported as "Amount looks wrong". Whatever left the
  // pair unmatched, the figures are identical and the screen must not say they
  // are not.
  const equal = [txn({ id: "t1", payeeName: "PK Mart", amount: -1455 })];

  it("does not claim the amount is wrong", () => {
    renderRow({ reasonCode: REASON.sameMerchantDate, actualTransactionIds: ["t1"] }, equal);

    expect(screen.queryByText("Amount looks wrong")).not.toBeInTheDocument();
    expect(screen.getByText("Same merchant, date and amount")).toBeInTheDocument();
  });

  it("still says so when they genuinely differ", () => {
    renderRow({ reasonCode: REASON.sameMerchantDate, actualTransactionIds: ["t1"] }, [
      txn({ id: "t1", amount: -165 }),
    ]);

    expect(screen.getByText("Amount looks wrong")).toBeInTheDocument();
    expect(screen.getByText("Same merchant and date")).toBeInTheDocument();
  });
});
