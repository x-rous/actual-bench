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

function renderOne(
  over: Partial<ReconciliationItem>,
  transaction: ActualTransactionSnapshot,
  handlers: {
    onUseCandidate?: (id: string | null) => void;
    onDisposition?: (d: ReconciliationItem["disposition"]) => void;
  } = {}
) {
  return render(
    <ItemActions
      item={{ ...item, actualTransactionIds: [transaction.id], ...over }}
      statementRow={statementRow()}
      transactions={[transaction]}
      onDisposition={handlers.onDisposition ?? (() => {})}
      onUseCandidate={handlers.onUseCandidate ?? (() => {})}
      onCorrectAmount={() => {}}
    />
  );
}

/*
 * A row the matcher paired with exactly one wrong candidate - the commonest
 * shape of this problem, and the one with no way out. Create is offered only
 * where nothing is attached, Delete removes a transaction the user never
 * disputed, and the picker's "None of these" is gated on there being more than
 * one candidate, so the answer existed and was unreachable.
 */
describe("declining a single wrong candidate", () => {
  const wrong = txn("t1", -1881);

  it("offers to say they are not the same", () => {
    renderOne({ reasonCode: REASON.amountMismatch }, wrong);
    expect(
      screen.getByRole("button", { name: /Not the same transaction/ })
    ).toBeInTheDocument();
  });

  it("releases the candidate rather than deciding anything", () => {
    // `onUseCandidate(null)` returns both sides to undecided and never deletes.
    // Separating is the removal of a wrong pairing, not a different answer:
    // the user may want to create the row, or link it to something else.
    const onUseCandidate = jest.fn();
    renderOne({ reasonCode: REASON.amountMismatch }, wrong, { onUseCandidate });

    screen.getByRole("button", { name: /Not the same transaction/ }).click();
    expect(onUseCandidate).toHaveBeenCalledWith(null);
  });

  it("does not offer it once the row is decided", () => {
    renderOne({ disposition: "matched", reasonCode: REASON.amountMismatch }, wrong);
    expect(
      screen.queryByRole("button", { name: /Not the same transaction/ })
    ).not.toBeInTheDocument();
  });
});

/*
 * A match that leaves the account disagreeing with the bank is not a match, so
 * accepting a pairing now takes the statement's amount with it. That makes
 * "These match" and "Use the statement's ..." one action, and only one of them
 * should be on screen.
 */
describe("a row whose amounts disagree", () => {
  const differs = txn("t1", -1881);
  const agrees = txn("t1", -1012);

  it("offers only the correction, since accepting the pair now means taking it", () => {
    renderOne({ reasonCode: REASON.amountMismatch }, differs);

    expect(screen.getByRole("button", { name: /Use the statement's/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /These match/ })).not.toBeInTheDocument();
    // The answer the user argued should not exist: same transaction, both
    // figures right, cannot be true.
    expect(screen.queryByRole("button", { name: /Keep Actual's/ })).not.toBeInTheDocument();
  });

  it("still says 'These match' where there is no amount question", () => {
    renderOne({ reasonCode: REASON.sameMerchantDate }, agrees);

    expect(screen.getByRole("button", { name: /These match/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use the statement's/ })).not.toBeInTheDocument();
  });

  /*
   * The one honest exception. Reconciled rows, split parents and transfer legs
   * refuse an amount change for reasons about Actual, not about this pairing -
   * so the difference is stuck rather than tolerated, and the button says so.
   */
  it.each([
    ["reconciled in Actual", { protectedReconciled: true, splitParent: false, transfer: "no" as const }],
    ["a split parent", { protectedReconciled: false, splitParent: true, transfer: "no" as const }],
    ["one leg of a transfer", { protectedReconciled: false, splitParent: false, transfer: "yes" as const }],
  ])("says what it is leaving behind when the row is %s", (_name, guards) => {
    renderOne({ reasonCode: REASON.amountMismatch, guards }, differs);

    expect(
      screen.getByRole("button", { name: /Match, leaving a .* difference/ })
    ).toBeInTheDocument();
  });
});

/*
 * `keep` and `ignored` run through the same branch in the planner and emit no
 * operation, so on a two-sided row Keep was a second Ignore - labelled in a way
 * that reads as a claim about the pairing it does not make.
 */
describe("Keep as is", () => {
  it("is not offered on a row that also has a statement row", () => {
    renderOne({ reasonCode: REASON.amountMismatch }, txn("t1", -1881));
    expect(screen.queryByRole("button", { name: /Keep as is/ })).not.toBeInTheDocument();
  });

  it("is offered where it means something, against delete", () => {
    render(
      <ItemActions
        item={{
          ...item,
          statementRowIds: [],
          actualTransactionIds: ["t1"],
          reasonCode: REASON.notOnStatement,
        }}
        statementRow={undefined}
        transactions={[txn("t1", -1881)]}
        onDisposition={() => {}}
        onUseCandidate={() => {}}
        onCorrectAmount={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /Keep as is/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete from Actual/ })).toBeInTheDocument();
  });
});
