"use client";

import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReconciliationView } from "./ReconciliationView";
import type { WorkbenchProps } from "./Workbench";
import type { ReconciliationSessionRecord } from "../lib/reconciliationApi";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { ActualTransactionSnapshot, ReconciliationItem, StatementRow } from "@/lib/reconciliation/types";
import { buildApplyPlan } from "@/lib/reconciliation/session/plan";
import { DEFAULT_MATCH_CONFIG } from "@/lib/reconciliation/match/config";

const mockConnection = { id: "connection", mode: "browser-api", budgetSyncId: "budget", baseUrl: "https://example.test" };
const mockConnectionState = { activeInstanceId: "connection", instances: [mockConnection] };
jest.mock("@/store/connection", () => ({
  useConnectionStore: Object.assign((selector: (state: unknown) => unknown) => selector(mockConnectionState), { getState: () => mockConnectionState }),
  selectActiveInstance: () => mockConnection,
  isHttpApiConnection: () => false,
}));
jest.mock("@/store/staged", () => ({ useStagedStore: (selector: (state: unknown) => unknown) => selector({ accounts: {} }) }));
jest.mock("@/hooks/useStagedEntities", () => ({
  useStagedAccounts: () => ({ groups: [] }), useStagedPayees: () => [], useStagedCategories: () => ({ categories: [], groups: [] }),
}));
jest.mock("@/features/payees/hooks/usePayees", () => ({ usePayees: () => {} }));
jest.mock("@/features/accounts/hooks/useAccounts", () => ({ useAccounts: () => {} }));
jest.mock("@/features/accounts/hooks/useAccountClasses", () => ({ useAccountClasses: () => ({ maps: { accounts: new Map(), groups: new Map() } }) }));
jest.mock("@/features/credit-cards/components/CardStatementFigures", () => ({
  useRegisteredCards: () => ({ ready: true, cards: [] }),
  CardStatementFigures: () => null,
  ReviewCardStatementLink: () => null,
  CardStatementHeaderAction: () => null,
}));
jest.mock("@/features/categories/hooks/useCategoryGroups", () => ({ useCategoryGroups: () => {} }));
jest.mock("@/lib/sync/capabilities", () => ({ getBudgetFileSyncCapabilities: () => ({ capabilities: { listTransactions: true } }) }));
jest.mock("@/components/layout/PageLayout", () => ({ PageLayout: ({ header, children }: { header?: ReactNode; children: ReactNode }) => <>{header}{children}</> }));
jest.mock("./SessionHeader", () => ({ SessionHeader: ({ actions, onExit }: { actions: ReactNode; onExit?: () => void }) => <>{actions}<button onClick={onExit}>Sessions</button></> }));
jest.mock("./SessionList", () => ({ rowCountOf: () => 1, SessionList: ({ onOpen }: { onOpen: (session: unknown) => void }) => <button onClick={() => onOpen(mockSession)}>Open saved session</button> }));
jest.mock("./NewSessionDialog", () => ({ NewSessionDialog: () => null }));
jest.mock("./ImportPanel", () => ({ ImportPanel: () => null }));
jest.mock("./Workbench", () => {
  const { useState } = jest.requireActual<typeof import("react")>("react");
  const { BulkDecisionBar } = jest.requireActual<typeof import("./BulkDecisionBar")>("./BulkDecisionBar");
  function MockWorkbench(props: WorkbenchProps) {
    const [selectionCleared, setSelectionCleared] = useState(false);
    return <>
      <p>{props.readOnly ? "Decisions disabled" : "Decisions enabled"}</p>
      <p>Current amounts: {[...props.transactions.values()].map((row) => row.amount).join(",")}</p>
      <p>Decision: {props.items[0]?.disposition}</p>
      <output aria-label="Staged decisions">{JSON.stringify(props.items)}</output>
      {!props.readOnly && <>
        <BulkDecisionBar selected={selectionCleared ? [] : props.items} statementRows={props.statementRows}
          transactions={props.transactions} lastBulkLabel={props.lastBulkLabel} onUndoBulk={props.onUndoBulk}
          onBulkDisposition={(ids, disposition) => { props.onBulkDisposition(ids, disposition); setSelectionCleared(true); }}
          onBulkCorrectAmount={(entries) => { props.onBulkCorrectAmount(entries); setSelectionCleared(true); }}
          onManualMatch={(bank, actual) => { props.onManualMatch(bank, actual); setSelectionCleared(true); }}
          onClear={() => setSelectionCleared(true)} />
        <button onClick={() => setSelectionCleared(false)}>Select test rows</button>
        <button onClick={() => props.onStage(props.items[0].id, "notes", "Later manual edit")}>Edit row notes</button>
        <button onClick={() => props.onCorrectAmount(props.items[0].id, props.items[0].actualTransactionIds[0], props.statementRows.get(props.items[0].statementRowIds[0])!.amount)}>Correct first amount</button>
        <button onClick={() => props.onDisposition(props.items[0].id, "matched")}>Accept first match</button>
        <button onClick={() => props.onBulkCorrectAmount([{ itemId: props.items[0].id, transactionId: props.items[0].actualTransactionIds[0], amount: props.statementRows.get(props.items[0].statementRowIds[0])!.amount }])}>Bulk correct first amount</button>
        <button onClick={() => props.onTransform([{ itemId: props.items[0].id,
          patch: { notes: { original: null, staged: "Later transformation", source: "transform" } } }])}>Transform row notes</button>
      </>}
    </>;
  }
  return { Workbench: MockWorkbench };
});
const mockSync = jest.fn();
const mockRead = jest.fn();
const mockUpdate = jest.fn();
const mockCommand = jest.fn();
const mockCreate = jest.fn();
jest.mock("@/lib/actual", () => ({ getTransport: () => ({ mode: "browser-api", sync: mockSync, listTransactionsForSync: mockRead, updateTransactionForSync: mockUpdate, createTransactionsForSync: mockCreate }) }));
jest.mock("../lib/reconciliationApi", () => ({
  sessionCommand: (...args: unknown[]) => mockCommand(...args),
  updateSession: jest.fn().mockResolvedValue({}), saveWork: jest.fn().mockResolvedValue({}),
}));
const mockSession: ReconciliationSessionRecord = {
  id: "session", budgetSyncId: "budget", accountId: "account", accountName: "Test account",
  profileId: null, status: "needs_review", statementFormat: "delimited", cardStatementId: null, statementName: null, tag: null,
  statementStart: "2026-07-01", statementEnd: "2026-07-31", candidateStart: null, candidateEnd: null,
  statementFingerprint: null, matchConfig: DEFAULT_MATCH_CONFIG, totals: null, applyConfig: null, applyResults: null,
  appliedAt: null, createdAt: "2026-07-01", updatedAt: "2026-07-01",
};
const current: SyncSourceTransaction = {
  id: "t1", accountId: "account", date: "2026-07-04", amount: -1000,
  payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null,
  cleared: true, reconciled: false, importedId: null, transferId: null,
  isParent: false, isChild: false, parentId: null, splitLines: [],
};
const mockData: { session: ReconciliationSessionRecord; statementRows: StatementRow[]; items: (ReconciliationItem & { actualSnapshot?: ActualTransactionSnapshot })[] } = {
  session: mockSession,
  statementRows: [{ id: "s1", sourceRowNumber: 1, postedDate: "2026-07-04", amount: -1000, importedPayee: "Bank", fingerprint: "fp", raw: {} }],
  items: [{ id: "i1", statementRowIds: ["s1"], actualTransactionIds: ["t1"], disposition: "unresolved", reasonCode: undefined,
    actualSnapshot: { ...current, importedPayee: null, scheduleId: null, transferId: null, amount: -9999 }, guards: { protectedReconciled: false, splitParent: false, transfer: "no" } }],
};
const mockMutations = { flushSaves: jest.fn(), loadSession: jest.fn(), retrySaves: jest.fn(),
  patchItems: { mutateAsync: jest.fn().mockResolvedValue({}) },
  replaceItems: { mutateAsync: jest.fn().mockResolvedValue({}) },
  updateSession: { mutateAsync: jest.fn().mockResolvedValue({}) }, createSession: { isPending: false } };
jest.mock("../hooks/useReconciliation", () => ({
  useReconciliationSessions: () => ({ data: [mockSession] }),
  useReconciliationSession: () => ({ data: mockData, refetch: jest.fn() }),
  useReconciliationProfiles: () => ({ data: [] }), usePdfStatementLayouts: () => ({ data: [] }),
  useReconciliationMutations: () => mockMutations,
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockCommand.mockReset(); mockCreate.mockReset();
  mockSession.applyConfig = null;
  mockSession.status = "needs_review"; mockSession.appliedAt = null; mockSession.applyResults = null;
  mockData.items = [{ id: "i1", statementRowIds: ["s1"], actualTransactionIds: ["t1"], disposition: "unresolved", reasonCode: undefined,
    actualSnapshot: { ...current, importedPayee: null, scheduleId: null, transferId: null, amount: -9999 },
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" } }];
  mockData.statementRows.splice(1);
  mockSync.mockResolvedValue(undefined); mockMutations.flushSaves.mockResolvedValue(undefined);
  mockMutations.loadSession.mockResolvedValue(mockData); mockMutations.retrySaves.mockResolvedValue(undefined);
});

it("keeps saved decisions disabled until a current read completes and fetches again on reopen", async () => {
  let release!: (rows: SyncSourceTransaction[]) => void;
  mockRead.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  render(<ReconciliationView />);
  fireEvent.click(screen.getByRole("button", { name: "Open saved session" }));
  await screen.findByText("Decisions disabled");
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
  expect(mockSync).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Current amounts:")).toBeInTheDocument();
  expect(screen.queryByText(/-9999/)).not.toBeInTheDocument();
  await act(async () => release([current]));
  await screen.findByText("Decisions enabled");
  expect(screen.getByText("Current amounts: -1000")).toBeInTheDocument();
  expect(screen.getByText("Decision: unresolved")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
  mockRead.mockResolvedValue([{ ...current, amount: -2000 }]);
  fireEvent.click(screen.getByRole("button", { name: "Open saved session" }));
  await screen.findByText("Current amounts: -2000");
  expect(mockSync).toHaveBeenCalledTimes(2);
  expect(mockMutations.loadSession).toHaveBeenCalledTimes(2);
});

it("keeps stale decisions disabled when Direct refresh fails, then retries the current read", async () => {
  mockSync.mockRejectedValueOnce(new Error("offline"));
  mockRead.mockResolvedValue([current]);
  render(<ReconciliationView />);
  fireEvent.click(screen.getByRole("button", { name: "Open saved session" }));
  await screen.findByRole("button", { name: "Retry reading Actual" });
  expect(screen.getByText("Decisions disabled")).toBeInTheDocument();
  expect(mockRead).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry reading Actual" }));
  await screen.findByText("Decisions enabled");
  expect(mockRead).toHaveBeenCalledTimes(1);
});

it("waits for saved decisions, claims Apply, then writes and verifies the approved change", async () => {
  mockSession.status = "ready";
  Object.assign(mockData.items[0], { disposition: "matched", actualSnapshot: { ...current, importedPayee: null, transferId: null, scheduleId: null },
    stagedChanges: { notes: { original: null, staged: "Reviewed", source: "manual" } } });
  let live = { ...current };
  mockRead.mockImplementation(async () => [live]);
  mockUpdate.mockImplementation(async (input: { notes?: string; importedPayee?: string }) => {
    live = { ...live, notes: input.notes ?? live.notes, importedPayee: input.importedPayee ?? live.importedPayee };
    return null;
  });
  mockCommand.mockImplementation(async (_id: string, input: { action: string; patch?: Record<string, unknown> }) => {
    if (input.action === "claim") mockSession.status = "applying";
    if (input.action === "finish") Object.assign(mockSession, input.patch);
    return { session: mockSession };
  });
  let release!: () => void;
  mockMutations.flushSaves.mockResolvedValueOnce(undefined).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  render(<ReconciliationView />);
  fireEvent.click(screen.getByRole("button", { name: "Open saved session" }));
  await screen.findByText("Decisions enabled");
  fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^Apply / }));
  await waitFor(() => expect(mockMutations.flushSaves).toHaveBeenCalledTimes(2));
  expect(mockCommand).not.toHaveBeenCalled(); expect(mockUpdate).not.toHaveBeenCalled();
  await act(async () => release());
  await screen.findByRole("heading", { name: /^Applied$/ });
  expect(mockCommand.mock.calls.map((call) => call[1].action)).toEqual(["claim", "finish"]);
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ notes: "Reviewed", transactionId: "t1", date: current.date, amount: current.amount }));
  expect(mockRead.mock.calls.length).toBeGreaterThanOrEqual(3);
});

it("recovers an interrupted update from its saved plan even if Actual subsequently reconciled the row", async () => {
  mockSession.status = "applying";
  Object.assign(mockData.items[0], { disposition: "matched", actualSnapshot: { ...current, importedPayee: null, scheduleId: null },
    stagedChanges: { notes: { original: null, staged: "Reviewed", source: "manual" } } });
  mockRead.mockResolvedValue([{ ...current, notes: "Reviewed", importedPayee: "Bank", reconciled: true }]);
  mockCommand.mockImplementation(async (_id: string, input: { patch?: Record<string, unknown> }) => {
    Object.assign(mockSession, input.patch); return { session: mockSession };
  });
  render(<ReconciliationView />);
  fireEvent.click(screen.getByRole("button", { name: "Open saved session" }));
  const recover = await screen.findByRole("button", { name: "Recover interrupted Apply" });
  await waitFor(() => expect(recover).toBeEnabled());
  fireEvent.click(recover);
  fireEvent.click(screen.getByRole("button", { name: "Read Actual and recover" }));
  await waitFor(() => expect(mockCommand).toHaveBeenCalledWith("session", expect.objectContaining({
    action: "recover", patch: expect.objectContaining({ status: "completed", applyResults: [expect.objectContaining({ operationId: "update:i1", status: "skipped" })] }),
  })));
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("saves statement amount decisions for multiple unresolved rows together and can undo them", async () => {
  const notes = { original: null, staged: "Reviewed", source: "manual" as const };
  Object.assign(mockData.items[0], { reasonCode: "amount-mismatch", stagedChanges: { notes } });
  mockData.items.push({ ...mockData.items[0], id: "i2", statementRowIds: ["s2"], actualTransactionIds: ["t2"] });
  mockData.statementRows.push({ ...mockData.statementRows[0], id: "s2", amount: -2000 });
  mockRead.mockResolvedValue([{ ...current, amount: -900 }, { ...current, id: "t2", amount: -1800 }]);
  render(<ReconciliationView />);
  fireEvent.click(screen.getByRole("button", { name: "Open saved session" }));
  await screen.findByText("Decisions enabled");
  fireEvent.click(screen.getByRole("button", { name: "Use the statement amount 2" }));
  expect(mockMutations.patchItems.mutateAsync).toHaveBeenCalledTimes(1);
  expect(mockMutations.patchItems.mutateAsync).toHaveBeenLastCalledWith({ sessionId: "session", items: [
    expect.objectContaining({ id: "i1", disposition: "correct-amount", stagedChanges: {
      notes, amount: { original: -900, staged: -1000, source: "manual" },
    } }),
    expect.objectContaining({ id: "i2", disposition: "correct-amount", stagedChanges: {
      notes, amount: { original: -1800, staged: -2000, source: "manual" },
    } }),
  ] });
  expect(JSON.parse(screen.getByLabelText("Staged decisions").textContent!).map((item: { disposition: string }) => item.disposition))
    .toEqual(["correct-amount", "correct-amount"]);
  expect(mockUpdate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Undo that" }));
  expect(mockMutations.patchItems.mutateAsync).toHaveBeenLastCalledWith({ sessionId: "session", items: [
    expect.objectContaining({ id: "i1", disposition: "unresolved", stagedChanges: { notes } }),
    expect.objectContaining({ id: "i2", disposition: "unresolved", stagedChanges: { notes } }),
  ] });
});

function stagedDecisions(): ReconciliationItem[] {
  return JSON.parse(screen.getByLabelText("Staged decisions").textContent!);
}

async function openBulkSession(items: ReconciliationItem[], live: SyncSourceTransaction[] = [...new Set(items.flatMap((item) => item.actualTransactionIds))].map((id) => ({ ...current, id }))) {
  mockData.items = items;
  mockData.statementRows = ["s1", "s2"].map((id) => ({ id, sourceRowNumber: 1, postedDate: current.date,
    amount: -1000, importedPayee: id, fingerprint: id, raw: {} }));
  mockRead.mockResolvedValue(live);
  render(<ReconciliationView />);
  fireEvent.click(screen.getByRole("button", { name: "Open saved session" }));
  await screen.findByText("Decisions enabled");
}

it.each([
  ["Create in Actual", "create", "statement", "create"],
  ["Keep", "keep", "actual", null],
  ["Delete from Actual", "delete", "actual", "delete"],
  ["Ignore", "ignored", "both", null],
] as const)("saves both %s decisions once, plans the right writes and restores prior edits on undo", async (label, disposition, shape, operation) => {
  const before: ReconciliationItem[] = [1, 2].map((n) => ({
    id: `i${n}`, statementRowIds: shape === "actual" ? [] : [`s${n}`],
    actualTransactionIds: shape === "statement" ? [] : [`t${n}`],
    disposition: n === 1 ? "unresolved" : "ignored",
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
    stagedChanges: { notes: { original: null, staged: "Keep my edit", source: "manual" } },
  }));
  await openBulkSession(before);
  fireEvent.click(screen.getByRole("button", { name: `${label} 2` }));
  expect(stagedDecisions().map((item) => item.disposition)).toEqual([disposition, disposition]);
  expect(mockMutations.patchItems.mutateAsync).toHaveBeenCalledTimes(1);
  expect(mockMutations.patchItems.mutateAsync.mock.calls[0][0].items).toHaveLength(2);
  expect(screen.queryByText("2 selected")).not.toBeInTheDocument();
  const plan = buildApplyPlan({ sessionId: "session", budgetSyncId: "budget", accountId: "account",
    items: stagedDecisions(), statementRows: new Map(mockData.statementRows.map((row) => [row.id, row])),
    transactions: new Map([current, { ...current, id: "t2" }].map((row) => [row.id, { ...row, importedPayee: null, scheduleId: null, transferId: null }])),
  });
  expect(plan.operations.map((entry) => entry.kind)).toEqual(operation ? [operation, operation] : []);
  expect(plan.blocked).toEqual([]);
  expect(mockUpdate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Undo that" }));
  expect(stagedDecisions()).toEqual(before);
  expect(mockMutations.patchItems.mutateAsync).toHaveBeenCalledTimes(2);
});

it("undoes only the most recent bulk decision", async () => {
  const before: ReconciliationItem[] = [1, 2].map((n) => ({ ...mockData.items[0], id: `i${n}`, statementRowIds: [], actualTransactionIds: [`t${n}`] }));
  await openBulkSession(before);
  fireEvent.click(screen.getByRole("button", { name: "Ignore 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Select test rows" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete from Actual 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Undo that" }));
  expect(stagedDecisions().map((item) => item.disposition)).toEqual(["ignored", "ignored"]);
});

it.each(["Edit row notes", "Transform row notes"])("does not let bulk undo discard a later %s", async (label) => {
  await openBulkSession([{ ...mockData.items[0], actualTransactionIds: [] }]);
  fireEvent.click(screen.getByRole("button", { name: "Create in Actual 1" }));
  expect(screen.getByRole("button", { name: "Undo that" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: label }));
  expect(screen.queryByRole("button", { name: "Undo that" })).not.toBeInTheDocument();
  expect(stagedDecisions()[0].stagedChanges?.notes?.staged).toMatch(/^Later /);
});

it.each(["ignored", "delete", "matched", "correct-amount"] as const)("can explicitly use the statement amount after %s", async (disposition) => {
  await openBulkSession([{ ...mockData.items[0], disposition,
    stagedChanges: { amount: { original: -900, staged: -800, source: "manual" } } }], [{ ...current, amount: -900 }]);
  fireEvent.click(screen.getByRole("button", { name: "Use the statement amount 1" }));
  expect(stagedDecisions()[0].disposition).toBe("correct-amount");
  expect(stagedDecisions()[0].stagedChanges?.amount).toEqual({ original: -900, staged: -1000, source: "manual" });
});

it("links only the two explicitly selected sides, saves once and clears the old bulk undo", async () => {
  await openBulkSession([
    { ...mockData.items[0], id: "bank", actualTransactionIds: [] },
    { ...mockData.items[0], id: "actual", statementRowIds: [] },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Ignore 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Select test rows" }));
  fireEvent.click(screen.getByRole("button", { name: "These are the same transaction 2" }));
  expect(stagedDecisions()).toHaveLength(1);
  expect(stagedDecisions()[0]).toEqual(expect.objectContaining({ id: "bank", disposition: "matched", actualTransactionIds: ["t1"] }));
  expect(mockMutations.replaceItems.mutateAsync).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Undo that" })).not.toBeInTheDocument();
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("keeps the staged decisions available and reports a failed bulk save", async () => {
  mockMutations.patchItems.mutateAsync.mockRejectedValueOnce(new Error("Could not save selected decisions"));
  await openBulkSession([{ ...mockData.items[0], actualTransactionIds: [] }]);
  fireEvent.click(screen.getByRole("button", { name: "Create in Actual 1" }));
  await screen.findByText("Could not save selected decisions");
  expect(stagedDecisions()[0].disposition).toBe("create");
  expect(mockUpdate).not.toHaveBeenCalled();
});


it.each([false, true])("persists new candidates and withdraws Create, including when the save fails (%s)", async (saveFails) => {
  mockData.items = [{ id: "i1", statementRowIds: ["s1"], actualTransactionIds: [], disposition: "create",
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" },
    stagedChanges: { notes: { original: null, staged: "Keep this note", source: "manual" } } }];
  mockRead.mockResolvedValueOnce([]).mockResolvedValue([{ ...current, payeeName: "Bank", importedPayee: "Bank" }]);
  if (saveFails) mockMutations.replaceItems.mutateAsync.mockRejectedValueOnce(new Error("Candidate save failed"));
  render(<ReconciliationView />);
  fireEvent.click(screen.getByRole("button", { name: "Open saved session" }));
  await screen.findByText("Decisions enabled");
  fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^Apply / }));
  await screen.findByText(saveFails ? "Candidate save failed" : "New Actual transactions may match rows marked Create. Review the new rows before applying.");
  expect(stagedDecisions()[0]).toMatchObject({ id: "i1", disposition: "unresolved", actualTransactionIds: ["t1"],
    stagedChanges: { notes: { staged: "Keep this note" } } });
  expect(mockMutations.replaceItems.mutateAsync).toHaveBeenCalledTimes(1);
  expect(mockMutations.replaceItems.mutateAsync.mock.calls[0][0].items[0].actualSnapshot.id).toBe("t1");
  // A second attempt returns to the decision gate; it cannot recreate the row.
  fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
  expect(screen.queryByRole("button", { name: /^Apply / })).not.toBeInTheDocument();
  expect(mockCommand).not.toHaveBeenCalled();
  expect(mockCreate).not.toHaveBeenCalled();
});

it.each(["Correct first amount", "Accept first match", "Bulk correct first amount"])("%s withdraws the transaction from competing rows and saves the whole decision", async (action) => {
  const before: ReconciliationItem[] = [1, 2].map((n) => ({ id: `i${n}`, statementRowIds: [`s${n}`], actualTransactionIds: ["t1"],
    disposition: "unresolved", reasonCode: "merchant-cluster", guards: { protectedReconciled: false, splitParent: false, transfer: "no" } }));
  await openBulkSession(before, [{ ...current, amount: -900 }]);
  fireEvent.click(screen.getByRole("button", { name: action }));
  expect(stagedDecisions()[0]).toMatchObject({ disposition: "correct-amount", actualTransactionIds: ["t1"], stagedChanges: { amount: { staged: -1000 } } });
  expect(stagedDecisions()[1].actualTransactionIds).toEqual([]);
  const saved = mockMutations.patchItems;
  expect(saved.mutateAsync).toHaveBeenCalledTimes(1);
  expect(saved.mutateAsync.mock.calls[0][0].items).toHaveLength(2);
  if (action === "Bulk correct first amount") {
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo that" }));
    expect(stagedDecisions()).toEqual(before);
  }
  expect(mockUpdate).not.toHaveBeenCalled();
});

it("sends Finish through signature comparison and leaves changed decisions open", async () => {
  mockData.items = [{ ...mockData.items[0], disposition: "ignored", actualTransactionIds: [] }];
  mockRead.mockResolvedValue([]);
  mockCommand.mockRejectedValue(new Error("The saved decisions changed. Reopen the reconciliation before finishing."));
  render(<ReconciliationView />);
  fireEvent.click(screen.getByRole("button", { name: "Open saved session" }));
  await screen.findByText("Decisions enabled");
  fireEvent.click(screen.getByRole("button", { name: /^Finish/ }));
  await screen.findByText("The saved decisions changed. Reopen the reconciliation before finishing.");
  expect(mockCommand).toHaveBeenCalledWith("session", { action: "complete", expected: expect.any(String) });
  expect(mockMutations.updateSession.mutateAsync).not.toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ status: "completed" }) }));
  expect(screen.queryByRole("heading", { name: "Finished" })).not.toBeInTheDocument();
  expect(mockSession.status).toBe("needs_review");
});

it("locks decisions during Finish and displays the server's retained history", async () => {
  mockData.items = [{ ...mockData.items[0], disposition: "ignored", actualTransactionIds: [] }];
  mockRead.mockResolvedValue([]);
  let release!: (value: unknown) => void;
  mockCommand.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  render(<ReconciliationView />);
  fireEvent.click(screen.getByRole("button", { name: "Open saved session" }));
  await screen.findByText("Decisions enabled");
  fireEvent.click(screen.getByRole("button", { name: /^Finish/ }));
  await screen.findByText("Decisions disabled");
  await waitFor(() => expect(mockCommand).toHaveBeenCalledTimes(1));
  await act(async () => release({ session: { ...mockSession, status: "completed", applyResults: [] } }));
  await screen.findByRole("heading", { name: "Finished" });
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockCreate).not.toHaveBeenCalled();
});


it("equal-amount acceptance also withdraws a shared candidate", async () => {
  await openBulkSession([1, 2].map((n) => ({ id: `i${n}`, statementRowIds: [`s${n}`], actualTransactionIds: ["t1"],
    disposition: "unresolved", guards: { protectedReconciled: false, splitParent: false, transfer: "no" } })));
  fireEvent.click(screen.getByRole("button", { name: "Accept first match" }));
  expect(stagedDecisions()[0].disposition).toBe("matched");
  expect(stagedDecisions()[1].actualTransactionIds).toEqual([]);
});

it("exposes a counterpart already present on resume for explicit pairing", async () => {
  // A failed prior save can leave Create persisted; the fresh read must expose its counterpart.
  mockData.items = [{ id: "i1", statementRowIds: ["s1"], actualTransactionIds: [], disposition: "create",
    guards: { protectedReconciled: false, splitParent: false, transfer: "no" } }];
  mockRead.mockResolvedValue([{ ...current, payeeName: "Bank", importedPayee: "Bank" }]);
  render(<ReconciliationView />);
  fireEvent.click(screen.getByRole("button", { name: "Open saved session" }));
  await screen.findByText("Decisions enabled");
  expect(stagedDecisions()).toEqual(expect.arrayContaining([expect.objectContaining({ disposition: "unresolved", actualTransactionIds: ["t1"] })]));
  fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
  expect(screen.queryByRole("button", { name: /^Apply / })).not.toBeInTheDocument();
  expect(mockCommand).not.toHaveBeenCalled();
  expect(mockCreate).not.toHaveBeenCalled();
});
