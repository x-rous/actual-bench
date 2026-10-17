"use client";

import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReconciliationView } from "./ReconciliationView";
import type { WorkbenchProps } from "./Workbench";
import type { ReconciliationSessionRecord } from "../lib/reconciliationApi";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
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
jest.mock("@/features/categories/hooks/useCategoryGroups", () => ({ useCategoryGroups: () => {} }));
jest.mock("@/lib/sync/capabilities", () => ({ getBudgetFileSyncCapabilities: () => ({ capabilities: { listTransactions: true } }) }));
jest.mock("@/components/layout/PageLayout", () => ({ PageLayout: ({ header, children }: { header?: ReactNode; children: ReactNode }) => <>{header}{children}</> }));
jest.mock("./SessionHeader", () => ({ SessionHeader: ({ actions, onExit }: { actions: ReactNode; onExit?: () => void }) => <>{actions}<button onClick={onExit}>Sessions</button></> }));
jest.mock("./SessionList", () => ({ rowCountOf: () => 1, SessionList: ({ onOpen }: { onOpen: (session: unknown) => void }) => <button onClick={() => onOpen(mockSession)}>Open saved session</button> }));
jest.mock("./NewSessionDialog", () => ({ NewSessionDialog: () => null }));
jest.mock("./ImportPanel", () => ({ ImportPanel: () => null }));
jest.mock("./Workbench", () => ({ Workbench: (props: WorkbenchProps) => <>
  <p>{props.readOnly ? "Decisions disabled" : "Decisions enabled"}</p>
  <p>Current amounts: {[...props.transactions.values()].map((row) => row.amount).join(",")}</p>
  <p>Decision: {props.items[0]?.disposition}</p>
</> }));
const mockSync = jest.fn();
const mockRead = jest.fn();
const mockUpdate = jest.fn();
const mockCommand = jest.fn();
jest.mock("@/lib/actual", () => ({ getTransport: () => ({ mode: "browser-api", sync: mockSync, listTransactionsForSync: mockRead, updateTransactionForSync: mockUpdate }) }));
jest.mock("../lib/reconciliationApi", () => ({
  sessionCommand: (...args: unknown[]) => mockCommand(...args),
  updateSession: jest.fn().mockResolvedValue({}), saveWork: jest.fn().mockResolvedValue({}),
}));
const mockSession: ReconciliationSessionRecord = {
  id: "session", budgetSyncId: "budget", accountId: "account", accountName: "Test account",
  profileId: null, status: "needs_review", statementFormat: "delimited", statementName: null, tag: null,
  statementStart: "2026-07-01", statementEnd: "2026-07-31", candidateStart: null, candidateEnd: null,
  statementFingerprint: null, matchConfig: DEFAULT_MATCH_CONFIG, totals: null, applyConfig: null, applyResults: null,
  appliedAt: null, createdAt: "2026-07-01", updatedAt: "2026-07-01",
};
const mockData = {
  session: mockSession,
  statementRows: [{ id: "s1", sourceRowNumber: 1, postedDate: "2026-07-04", amount: -1000, importedPayee: "Bank", fingerprint: "fp", raw: {} }],
  items: [{ id: "i1", statementRowIds: ["s1"], actualTransactionIds: ["t1"], disposition: "unresolved", reasonCode: null,
    actualSnapshot: { id: "t1", amount: -9999 }, guards: { protectedReconciled: false, splitParent: false, transfer: "no" } }],
};
const mockMutations = { flushSaves: jest.fn(), loadSession: jest.fn(), retrySaves: jest.fn(),
  updateSession: { mutateAsync: jest.fn() }, createSession: { isPending: false } };
jest.mock("../hooks/useReconciliation", () => ({
  useReconciliationSessions: () => ({ data: [mockSession] }),
  useReconciliationSession: () => ({ data: mockData, refetch: jest.fn() }),
  useReconciliationProfiles: () => ({ data: [] }), usePdfStatementLayouts: () => ({ data: [] }),
  useReconciliationMutations: () => mockMutations,
}));
const current: SyncSourceTransaction = {
  id: "t1", accountId: "account", date: "2026-07-04", amount: -1000,
  payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null,
  cleared: true, reconciled: false, importedId: null, transferId: null,
  isParent: false, isChild: false, parentId: null, splitLines: [],
};
beforeEach(() => {
  jest.clearAllMocks();
  mockSession.status = "needs_review"; mockSession.appliedAt = null; mockSession.applyResults = null;
  mockData.items[0].disposition = "unresolved";
  delete (mockData.items[0] as { stagedChanges?: unknown }).stagedChanges;
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
