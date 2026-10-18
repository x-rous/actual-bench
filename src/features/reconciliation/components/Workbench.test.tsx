"use client";

import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_MATCH_CONFIG, DEFAULT_TEXT_PRESET } from "@/lib/reconciliation/match/config";
import { summarizeCoverage } from "@/lib/reconciliation/session/build";
import { DEFAULT_APPLY_CONFIG } from "@/lib/reconciliation/session/plan";
import type { ActualTransactionSnapshot, ReconciliationItem, StatementRow } from "@/lib/reconciliation/types";
import { Workbench, type WorkbenchProps } from "./Workbench";
import type { TransformDialogProps } from "./TransformDialog";

jest.mock("./TransformDialog", () => ({ TransformDialog: (props: TransformDialogProps) => <>
  <output aria-label="Transform rows">{props.items.map((item) => item.id).join(",")}</output>
  <output aria-label="Transform selection">{[...props.selectedIds].join(",")}</output>
</> }));

const transaction: ActualTransactionSnapshot = {
  id: "t1", accountId: "account", date: "2026-07-04", amount: -900,
  payeeId: null, payeeName: null, importedPayee: null, categoryId: null, categoryName: null,
  notes: null, cleared: true, reconciled: false, importedId: null, transferId: null, scheduleId: null,
  isParent: false, isChild: false, parentId: null, splitLines: [],
};
const base: ReconciliationItem = {
  id: "i1", statementRowIds: ["s1"], actualTransactionIds: ["t1"], disposition: "unresolved",
  guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
};
function propsFor(items: ReconciliationItem[]): WorkbenchProps {
  const statementRows = new Map<string, StatementRow>(items.flatMap((item) => item.statementRowIds.map((id) => [id, {
    id, sourceRowNumber: 1, postedDate: transaction.date, amount: -1000, importedPayee: id, fingerprint: id, raw: {},
  }] as const)));
  const transactions = new Map(items.flatMap((item) => item.actualTransactionIds.map((id) => [id, { ...transaction, id }] as const)));
  return {
    items, statementRows, transactions, coverage: summarizeCoverage(items, { statementRows: statementRows.size, loadedTransactions: transactions.size }),
    matchConfig: DEFAULT_MATCH_CONFIG, matchPreset: DEFAULT_TEXT_PRESET, isMatching: false, canRematch: true,
    payees: [], categories: [], applyConfig: DEFAULT_APPLY_CONFIG,
    onMatchConfigChange: jest.fn(), onRematch: jest.fn(), onDisposition: jest.fn(), onUseCandidate: jest.fn(),
    onCorrectAmount: jest.fn(), onStage: jest.fn(), onUnstage: jest.fn(), onBulkDisposition: jest.fn(),
    onBulkCorrectAmount: jest.fn(), onManualMatch: jest.fn(), onApplyConfigChange: jest.fn(), onTransform: jest.fn(),
    transformContextFor: () => { throw new Error("The stub dialog does not evaluate rules"); },
  };
}

const mixed: ReconciliationItem[] = [
  { ...base, id: "statement", actualTransactionIds: [] },
  { ...base, id: "actual", statementRowIds: [], actualTransactionIds: ["actual"] },
  { ...base, id: "paired" },
  { ...base, id: "reconciled", actualTransactionIds: ["reconciled"], guards: { ...base.guards, protectedReconciled: true } },
  { ...base, id: "transfer", actualTransactionIds: ["transfer"], guards: { ...base.guards, transfer: "yes" } },
  { ...base, id: "unknown", actualTransactionIds: ["unknown"], guards: { ...base.guards, transfer: "unknown" } },
  { ...base, id: "split", actualTransactionIds: ["split"], guards: { ...base.guards, splitParent: true } },
  { ...base, id: "contested", actualTransactionIds: ["candidate1", "candidate2"] },
];

it.each([
  ["Create in Actual 1", "create", ["statement"]],
  ["Keep 1", "keep", ["actual"]],
  ["Delete from Actual 3", "delete", ["actual", "paired", "split"]],
  ["Ignore 8", "ignored", mixed.map((item) => item.id)],
] as const)("%s only sends eligible rows and clears the selection", (label, disposition, ids) => {
  const props = propsFor(mixed);
  render(<Workbench {...props} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible rows" }));
  fireEvent.click(screen.getByRole("button", { name: label }));
  expect(props.onBulkDisposition).toHaveBeenCalledTimes(1);
  expect(props.onBulkDisposition).toHaveBeenCalledWith(expect.arrayContaining([...ids]), disposition);
  expect((props.onBulkDisposition as jest.Mock).mock.calls[0][0]).toHaveLength(ids.length);
  expect(screen.queryByText("8 selected")).not.toBeInTheDocument();
});

it("amount corrections exclude reconciled rows, splits, transfers and unresolved candidate choices", () => {
  const props = propsFor(mixed);
  render(<Workbench {...props} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible rows" }));
  fireEvent.click(screen.getByRole("button", { name: "Use the statement amount 1" }));
  expect(props.onBulkCorrectAmount).toHaveBeenCalledWith([{ itemId: "paired", transactionId: "t1", amount: -1000 }]);
  expect(screen.queryByText("8 selected")).not.toBeInTheDocument();
});

it("does not retain hidden selected rows when a row stops matching the current filter", () => {
  const props = propsFor([base, { ...base, id: "i2", statementRowIds: ["s2"], actualTransactionIds: ["t2"] }]);
  const view = render(<Workbench {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Undecided" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible rows" }));
  view.rerender(<Workbench {...props} items={[{ ...base, disposition: "ignored" }, props.items[1]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Ignore 1" }));
  expect(props.onBulkDisposition).toHaveBeenCalledWith(["i2"], "ignored");
});

it("leaves already-applied rows out of Transform's rows and selection", () => {
  const props = propsFor([base, { ...base, id: "i2", actualTransactionIds: ["t2"] }]);
  render(<Workbench {...props} appliedItemIds={new Set(["i1"])} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible rows" }));
  fireEvent.click(screen.getByRole("button", { name: "Transform" }));
  expect(screen.getByText("1 selected")).toBeInTheDocument();
  expect(screen.getByLabelText("Transform rows")).toHaveTextContent(/^i2$/);
  expect(screen.getByLabelText("Transform selection")).toHaveTextContent(/^i2$/);
});

it("offers bulk undo after selection clears and drops selection when the search changes", () => {
  const props = propsFor([base]);
  const onUndoBulk = jest.fn();
  render(<Workbench {...props} lastBulkLabel="1 row" onUndoBulk={onUndoBulk} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible rows" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search reconciliation rows" }), { target: { value: "s1" } });
  expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undo that" }));
  expect(onUndoBulk).toHaveBeenCalledTimes(1);
});

it("does not offer bulk decisions or Transform on a read-only session", () => {
  render(<Workbench {...propsFor([base])} readOnly />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible rows" }));
  expect(screen.queryByRole("button", { name: /Ignore 1/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Transform" })).toBeDisabled();
});

it("disables Transform when every row is already applied", () => {
  render(<Workbench {...propsFor([base])} appliedItemIds={new Set(["i1"])} />);
  expect(screen.getByRole("button", { name: "Transform" })).toBeDisabled();
});

it.each(["statement", "actual", "three"] as const)("does not infer a manual pair from a %s selection", (shape) => {
  const items = shape === "three" ? mixed.slice(0, 3) : [1, 2].map((n) => ({ ...base, id: `i${n}`,
    statementRowIds: shape === "actual" ? [] : [`s${n}`],
    actualTransactionIds: shape === "statement" ? [] : [`t${n}`],
  }));
  render(<Workbench {...propsFor(items)} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible rows" }));
  expect(screen.queryByRole("button", { name: /These are the same transaction/ })).not.toBeInTheDocument();
});

it.each([false, true])("does not bulk write a shared candidate (other bank row hidden: %s)", (hideOther) => {
  const props = propsFor([base, { ...base, id: "i2", statementRowIds: ["s2"] }]);
  render(<Workbench {...props} />);
  if (hideOther) fireEvent.change(screen.getByRole("textbox", { name: "Search reconciliation rows" }), { target: { value: "s1" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible rows" }));
  expect(screen.queryByRole("button", { name: /Use the statement amount/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Delete from Actual/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: `Ignore ${hideOther ? 1 : 2}` })).toBeInTheDocument();
});

it.each(["matched", "correct-amount", "delete"] as const)("excludes a bulk candidate owned by a hidden %s row after its group disappears", (disposition) => {
  const props = propsFor([{ ...base, disposition }, { ...base, id: "i2", statementRowIds: ["s2"] }]);
  render(<Workbench {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Search reconciliation rows" }), { target: { value: "s2" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible rows" }));
  expect(screen.queryByRole("button", { name: /Use the statement amount/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Delete from Actual/ })).not.toBeInTheDocument();
});
