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
      "2 imported payees - set from the statement's payee"
    );
  });

  it("reports a delimited statement's notes as the mapped column, not the switches", () => {
    // On a CSV the mapped Notes column decides, and `resolveNotesSwitches`
    // forces it. Reading the stored switches here described a write that would
    // not happen - the review screen contradicted the import screen beside it.
    render(
      <ReviewPanel
        plan={{
          // The summary names the notes source only where a row is created.
          operations: [
            {
              id: "create-1",
              kind: "create",
              itemId: "1",
              statementRowId: "r-1",
              accountId: "acct-1",
              date: "2026-07-04",
              amount: -1250,
              payeeId: null,
              importedPayee: "AMAZON AE",
              payeeName: null,
              notes: "Order 402",
              cleared: true,
            },
          ] as ApplyPlan["operations"],
          alreadyApplied: 0,
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
        applyConfig={{ ...DEFAULT_APPLY_CONFIG, notesFromMemo: false, notesIncludePayee: true }}
        statementFormat="delimited"
        onApplyConfigChange={() => {}}
      />
    );

    expect(screen.getByText(/the mapped Notes column/i)).toBeInTheDocument();
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
