"use client";

import { render, screen, within } from "@testing-library/react";
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
