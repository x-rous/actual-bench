"use client";

import { render, screen } from "@testing-library/react";
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
import { ReviewPanel } from "./ReviewPanel";

function statementRow(id: string, merchant: string): StatementRow {
  return {
    id: `s-${id}`,
    sourceRowNumber: Number(id),
    postedDate: `2025-08-0${id}`,
    amount: -1000 * Number(id),
    importedPayee: merchant,
    raw: {},
    fingerprint: `fingerprint-${id}`,
  };
}

function transaction(id: string): ActualTransactionSnapshot {
  return {
    id: `t-${id}`,
    accountId: "a1",
    date: `2025-08-0${id}`,
    amount: -1000 * Number(id),
    payeeId: `p-${id}`,
    payeeName: `Payee ${id}`,
    importedPayee: null,
    categoryId: null,
    categoryName: null,
    notes: id === "2" ? "Original note" : null,
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

function item(id: string, stagedChanges?: StagedPatch): ReconciliationItem {
  return {
    id: `i-${id}`,
    statementRowIds: [`s-${id}`],
    actualTransactionIds: [`t-${id}`],
    disposition: "matched",
    guards: {
      protectedReconciled: false,
      splitParent: false,
      transfer: "no",
    },
    stagedChanges,
  };
}

function update(id: string, merchant: string, patch: StagedPatch = {}): UpdateOperation {
  return {
    id: `update:i-${id}`,
    kind: "update",
    itemId: `i-${id}`,
    transactionId: `t-${id}`,
    accountId: "a1",
    date: `2025-08-0${id}`,
    amount: -1000 * Number(id),
    patch,
    importedPayee: merchant,
  };
}

describe("reconciliation review field summary", () => {
  it("counts every imported-payee write, including one riding on a staged edit", () => {
    const notesPatch: StagedPatch = {
      notes: {
        original: "Original note",
        staged: "#2025-08 Original note",
        source: "manual",
      },
    };
    const rows = [
      statementRow("1", "AMAZON AE"),
      statementRow("2", "TALABAT AE"),
    ];
    const transactions = [transaction("1"), transaction("2")];
    const items = [item("1"), item("2", notesPatch)];
    const plan: ApplyPlan = {
      operations: [
        update("1", "AMAZON AE"),
        update("2", "TALABAT AE", notesPatch),
      ],
      alreadyApplied: 0,
      noWriteMatches: 0,
      unresolved: 0,
      blocked: [],
    };

    render(
      <ReviewPanel
        plan={plan}
        items={items}
        statementRows={new Map(rows.map((row) => [row.id, row]))}
        transactions={new Map(transactions.map((entry) => [entry.id, entry]))}
        payees={[
          { id: "p-1", name: "Payee 1" },
          { id: "p-2", name: "Payee 2" },
        ]}
        categories={[]}
        drift={null}
        applyConfig={DEFAULT_APPLY_CONFIG}
        onApplyConfigChange={() => {}}
      />
    );

    const summary = screen.getByText("Fields that will be written:").parentElement;
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent("1 note");
    expect(summary).toHaveTextContent(
      "2 imported payees — set from the bank statement's merchant text"
    );
  });

  it("shows the executed write settings as disabled for an applied reconciliation", () => {
    const config = {
      ...DEFAULT_APPLY_CONFIG,
      clearedTarget: "reconciled" as const,
      enrichImportedPayee: false,
    };

    render(
      <ReviewPanel
        plan={{
          operations: [],
          alreadyApplied: 1,
          noWriteMatches: 0,
          unresolved: 0,
          blocked: [],
        }}
        items={[]}
        statementRows={new Map()}
        transactions={new Map()}
        payees={[]}
        categories={[]}
        drift={null}
        applyConfig={config}
        onApplyConfigChange={() => {}}
        writeSettingsLocked
      />
    );

    expect(screen.getByText(/These settings are locked/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Everything confirmed" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Everything confirmed" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "On new rows only" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "On new rows only" })).toBeDisabled();
  });
});
