"use client";

import { fireEvent, render, screen, within } from "@testing-library/react";
import type {
  ApplyPlan,
  UpdateOperation,
} from "@/lib/reconciliation/apply/operations";
import { DEFAULT_APPLY_CONFIG } from "@/lib/reconciliation/session/plan";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StagedPatch,
  StatementRow,
} from "@/lib/reconciliation/types";
import { ReviewComparison } from "./ReviewComparison";

const BANK_TEXT = "Amazon.ae Dubai DXB";

function statementRow(): StatementRow {
  return {
    id: "s1",
    sourceRowNumber: 1,
    postedDate: "2025-08-07",
    amount: -12550,
    importedPayee: BANK_TEXT,
    raw: {},
    fingerprint: "statement-row",
  };
}

function transaction(importedPayee: string | null = null): ActualTransactionSnapshot {
  return {
    id: "t1",
    accountId: "a1",
    date: "2025-08-07",
    amount: -12550,
    payeeId: "p1",
    payeeName: "Amazon",
    importedPayee,
    categoryId: "c1",
    categoryName: "Shopping",
    notes: "#2025-08 Amazon.ae Dubai DXB",
    cleared: false,
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

function item(stagedChanges?: StagedPatch): ReconciliationItem {
  return {
    id: "i1",
    statementRowIds: ["s1"],
    actualTransactionIds: ["t1"],
    disposition: "matched",
    guards: {
      protectedReconciled: false,
      splitParent: false,
      transfer: "no",
    },
    stagedChanges,
  };
}

function update(patch: StagedPatch = {}): UpdateOperation {
  return {
    id: "update:i1",
    kind: "update",
    itemId: "i1",
    transactionId: "t1",
    accountId: "a1",
    date: "2025-08-07",
    amount: -12550,
    patch,
    importedPayee: BANK_TEXT,
  };
}

function plan(operation: UpdateOperation): ApplyPlan {
  return {
    operations: [operation],
    alreadyApplied: 0,
    noWriteMatches: 0,
    unresolved: 0,
    blocked: [],
  };
}

function renderComparison(options: {
  importedPayee?: string | null;
  stagedChanges?: StagedPatch;
}) {
  const actual = transaction(options.importedPayee ?? null);
  const reconciliationItem = item(options.stagedChanges);
  const operation = update(options.stagedChanges);

  render(
    <ReviewComparison
      plan={plan(operation)}
      items={[reconciliationItem]}
      statementRows={new Map([["s1", statementRow()]])}
      transactions={new Map([["t1", actual]])}
      payees={[{ id: "p1", name: "Amazon" }]}
      categories={[{ id: "c1", name: "Shopping" }]}
      applyConfig={DEFAULT_APPLY_CONFIG}
    />
  );
}

describe("reconciliation review write labels", () => {
  it("names a fill-only imported-payee write as neutral bank text", () => {
    renderComparison({});

    const action = screen.getByText("Bank text").closest("td");
    expect(action).toHaveClass("text-muted-foreground");
    expect(action).not.toHaveClass("text-amber-600");
    expect(action).toHaveTextContent(
      "records the statement description as the imported payee; payee, notes and category are unchanged"
    );
    expect(action).toHaveAttribute(
      "title",
      "Records the statement description as this transaction's imported payee."
    );

    const row = action?.closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText(BANK_TEXT)).toBeInTheDocument();
    expect(within(row!).getByText("#2025-08 Amazon.ae Dubai DXB")).not.toHaveClass(
      "text-amber-600"
    );
  });

  it("shows and highlights the previous imported payee when it will be replaced", () => {
    renderComparison({ importedPayee: "AMZN MKTP AE" });

    const previous = screen.getByText("was: AMZN MKTP AE");
    const action = previous.closest("td");
    expect(action).toHaveClass("text-amber-600");
    expect(previous).toHaveClass("truncate");
    expect(previous).toHaveAttribute("title", "Imported payee was: AMZN MKTP AE");
  });

  it("names a staged edit that also records bank text as a mixed write", () => {
    const patch: StagedPatch = {
      notes: {
        original: "#2025-08 Amazon.ae Dubai DXB",
        staged: "#2025-08 Amazon.ae Dubai DXB · household",
        source: "manual",
      },
    };
    renderComparison({ stagedChanges: patch });

    const action = screen.getByText("Update + bank text").closest("td");
    expect(action).toHaveClass("text-amber-600");
    expect(screen.getByText("#2025-08 Amazon.ae Dubai DXB · household")).toHaveClass(
      "text-amber-600"
    );
  });
});

/*
 * "What exactly am I deleting" is a question worth being able to ask directly.
 * Scrolling a few hundred rows looking for the four amber ones is not an answer.
 *
 * The fixture carries one row of each kind on purpose. An earlier version had
 * only an update, so selecting "Update" narrowed nothing and the test passed
 * whether or not the filter was wired up at all.
 */
describe("narrowing the table to one kind of write", () => {
  const created: StatementRow = {
    id: "s2",
    sourceRowNumber: 2,
    postedDate: "2025-08-08",
    amount: -2200,
    importedPayee: "SPARKYS TAIF",
    raw: {},
    fingerprint: "fingerprint-s2",
  };
  const removed = { ...transaction(null), id: "t2", payeeName: "Old Payee" };

  function renderMixed() {
    const actual = transaction(null);
    render(
      <ReviewComparison
        plan={{
          operations: [
            update(undefined),
            {
              id: "create-2",
              kind: "create" as const,
              itemId: "2",
              statementRowId: "s2",
              accountId: "acct-1",
              date: "2025-08-08",
              amount: -2200,
              payeeId: null,
              payeeName: null,
              importedPayee: "SPARKYS TAIF",
              categoryId: null,
              notes: null,
              cleared: false,
              marker: "recon:2",
            },
            {
              id: "delete-3",
              kind: "delete" as const,
              itemId: "3",
              transactionId: "t2",
              accountId: "acct-1",
              date: "2025-08-09",
              amount: -900,
            },
          ],
          alreadyApplied: 0,
          noWriteMatches: 0,
          unresolved: 0,
          blocked: [],
        }}
        items={[
          item(undefined),
          { id: "2", statementRowIds: ["s2"], actualTransactionIds: [], disposition: "create",
            guards: { protectedReconciled: false, splitParent: false, transfer: "no" } },
          { id: "3", statementRowIds: [], actualTransactionIds: ["t2"], disposition: "delete",
            guards: { protectedReconciled: false, splitParent: false, transfer: "no" } },
        ]}
        statementRows={new Map([["s1", statementRow()], ["s2", created]])}
        transactions={new Map([["t1", actual], ["t2", removed]])}
        payees={[{ id: "p1", name: "Amazon" }]}
        categories={[{ id: "c1", name: "Shopping" }]}
        applyConfig={DEFAULT_APPLY_CONFIG}
      />
    );
  }

  it("offers every kind that is in play, with its count", () => {
    renderMixed();

    const group = screen.getByRole("group", { name: "Filter by what will happen" });
    for (const label of ["Create", "Update", "Delete"]) {
      expect(within(group).getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("shows only the chosen kind, and restores the rest", () => {
    renderMixed();

    const group = screen.getByRole("group", { name: "Filter by what will happen" });
    const rowsBefore = screen.getAllByRole("row").length;

    fireEvent.click(within(group).getByRole("button", { name: /Create/ }));

    // Only the created row survives: the statement text it would write is
    // there, and the table is shorter than it was.
    expect(screen.getAllByText("SPARKYS TAIF").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("row").length).toBeLessThan(rowsBefore);

    // A different kind hides it again, so the filter is doing the narrowing
    // rather than the row simply always being present.
    fireEvent.click(within(group).getByRole("button", { name: /Delete/ }));
    expect(screen.queryAllByText("SPARKYS TAIF")).toHaveLength(0);

    fireEvent.click(within(group).getByRole("button", { name: "All" }));
    expect(screen.getAllByText("SPARKYS TAIF").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("row").length).toBe(rowsBefore);
  });
});

