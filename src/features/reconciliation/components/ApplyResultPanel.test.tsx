"use client";

import { render, screen } from "@testing-library/react";
import type { ApplyRunResult } from "@/lib/reconciliation/apply/executor";
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
import { ApplyResultPanel } from "./ApplyResultPanel";

function statementRow(): StatementRow {
  return {
    id: "s1",
    sourceRowNumber: 1,
    postedDate: "2025-08-07",
    amount: -12550,
    importedPayee: "Amazon.ae Dubai DXB",
    raw: {},
    fingerprint: "statement-row",
  };
}

function transaction(): ActualTransactionSnapshot {
  return {
    id: "t1",
    accountId: "a1",
    date: "2025-08-07",
    amount: -12550,
    payeeId: "p1",
    payeeName: "Amazon",
    importedPayee: null,
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

function renderResult(patch: StagedPatch = {}) {
  const reconciliationItem: ReconciliationItem = {
    id: "i1",
    statementRowIds: ["s1"],
    actualTransactionIds: ["t1"],
    disposition: "matched",
    guards: {
      protectedReconciled: false,
      splitParent: false,
      transfer: "no",
    },
    stagedChanges: Object.keys(patch).length > 0 ? patch : undefined,
  };
  const operation: UpdateOperation = {
    id: "update:i1",
    kind: "update",
    itemId: "i1",
    transactionId: "t1",
    accountId: "a1",
    date: "2025-08-07",
    amount: -12550,
    patch,
    importedPayee: "Amazon.ae Dubai DXB",
  };
  const plan: ApplyPlan = {
    operations: [operation],
    alreadyApplied: 0,
    noWriteMatches: 0,
    unresolved: 0,
    blocked: [],
  };
  const result: ApplyRunResult = {
    results: [{ operationId: operation.id, status: "applied", transactionId: "t1" }],
    applied: 1,
    failed: 0,
    skipped: 0,
    complete: true,
  };

  render(
    <ApplyResultPanel
      plan={plan}
      items={[reconciliationItem]}
      statementRows={new Map([["s1", statementRow()]])}
      transactions={new Map([["t1", transaction()]])}
      payees={[{ id: "p1", name: "Amazon" }]}
      applyConfig={DEFAULT_APPLY_CONFIG}
      result={result}
      verification={null}
      isVerifying={false}
    />
  );
}

describe("reconciliation apply-result write labels", () => {
  it("records a provenance-only outcome as a bank detail", () => {
    renderResult();

    expect(screen.getByText("1 bank detail written")).toBeInTheDocument();
    expect(screen.getByText("Bank text")).toBeInTheDocument();
    expect(screen.queryByText("Updated")).toBeNull();
  });

  it("states when an update also recorded bank text", () => {
    renderResult({
      notes: {
        original: "#2025-08 Amazon.ae Dubai DXB",
        staged: "#2025-08 Amazon.ae Dubai DXB · household",
        source: "manual",
      },
    });

    expect(screen.getByText("1 change written")).toBeInTheDocument();
    expect(screen.getByText("Updated + bank text")).toBeInTheDocument();
  });
});
