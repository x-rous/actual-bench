import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { runLoanRefresh, useBackgroundRefresh } from "./useBackgroundRefresh";
import { readOffsetHistories } from "@/lib/assets-debt/services/offsetHistoryService";
import { toDebtMagnitude } from "@/lib/assets-debt/actual/ledgerPort";
import { stripState } from "./LoanStatusStrip";
import * as postingsApi from "../../lib/postingsApi";

const transport = { sync: jest.fn(async () => {}), getPayees: jest.fn(async () => []), queryTransactionsForSync: jest.fn(), canVerifyTransferLinks: undefined };
jest.mock("@/lib/actual", () => ({ getTransport: () => transport }));
jest.mock("@/store/connection", () => ({ selectActiveInstance: (s: unknown) => s, useConnectionStore: () => ({ id: "c", baseUrl: "http://x", budgetSyncId: "b" }) }));
jest.mock("@/lib/assets-debt/actual/ledgerPort", () => ({
  readAccountLedger: jest.fn(async () => ({ ok: true, transactions: [] })),
  readMatchingHistory: jest.fn(async () => []),
  datedBalanceFromTransactions: () => ({ balanceMinor: 0 }),
  toDebtMagnitude: jest.fn(() => -1),
}));
jest.mock("../../lib/postingsApi", () => ({ previewPostings: jest.fn(), listPostings: jest.fn(async () => []) }));
jest.mock("../../lib/debtsApi", () => ({ getDebtReconciliation: jest.fn(), listMatchRules: jest.fn(async () => []) }));
jest.mock("@/lib/assets-debt/services/offsetHistoryService", () => ({ readOffsetHistories: jest.fn() }));
jest.mock("../../lib/scopedReads", () => ({ ...jest.requireActual("../../lib/scopedReads"), readRanges: jest.fn(async () => []) }));
const preview = postingsApi.previewPostings as jest.Mock;

const fixture = { debt: { id: "d1", budgetSyncId: "b", status: "active", liabilityAccountId: "loan", paymentAccountId: null, signConvention: "negative-is-debt", currentRevision: 1, onboardingDate: null }, offsets: [] };
const debt = fixture as never;
const directory = { budgetSyncId: "b", accounts: [], categories: [] } as never;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const ok = { ok: true, postings: [], notices: [], driftMaterial: false };

/** Sync Repayments keeps itself current without repeated clicks (owner decision 2026-10-07). */
describe("background refresh", () => {
  beforeEach(() => { jest.clearAllMocks(); transport.sync.mockResolvedValue(undefined); jest.mocked(toDebtMagnitude).mockReturnValue(-1); });

  it("finishes automatic refresh after Strict Mode replays the mount effects", async () => {
    jest.mocked(toDebtMagnitude).mockReturnValue(0);
    preview.mockResolvedValue({ ...ok, reconciliation: { comparison: { actualMinor: 0, modelMinor: 0, lenderMinor: null, modelVsActualMinor: 0, actualVsLenderMinor: null }, health: { overdue: false }, drift: "within", lenderObservation: null } });
    const strictWrapper = ({ children }: { children: ReactNode }) => <StrictMode>{wrapper({ children })}</StrictMode>;
    const { result } = renderHook(() => useBackgroundRefresh({ debt, directory, from: "2024-01-01", to: "2024-02-01" }), { wrapper: strictWrapper });
    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(preview).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.status).toMatchObject({ actualMinor: 0, modelMinor: 0 });
    expect(stripState(result.current.status, { review: 0, notApplied: 0 }, 2).text).toBe("In sync");
  });

  it("starts automatic refresh when the account directory becomes available", async () => {
    preview.mockResolvedValue(ok);
    const { result, rerender } = renderHook(({ ready }) => useBackgroundRefresh({ debt, directory: ready ? directory : undefined, from: "2024-01-01", to: "2024-02-01" }), { wrapper, initialProps: { ready: false } });
    expect(preview).not.toHaveBeenCalled();
    rerender({ ready: true });
    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("reloads the loan list's cached failed-change count after a successful refresh", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const key = ["assets-debt", "attention", "b"];
    const oldAttention = [{ id: "d1", reasons: [{ code: "failed", count: 2 }] }];
    client.setQueryData(key, oldAttention);
    const otherBudgetKey = ["assets-debt", "attention", "other-budget"];
    client.setQueryData(otherBudgetKey, oldAttention);
    const loadAttention = jest.fn(async () => []);
    const listQuery = { queryKey: key, queryFn: loadAttention, staleTime: Infinity };
    expect(await client.fetchQuery(listQuery)).toEqual(oldAttention);
    expect(loadAttention).not.toHaveBeenCalled();

    preview.mockResolvedValue(ok);
    const localWrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, unmount } = renderHook(() => useBackgroundRefresh({ debt, directory, from: "2024-01-01", to: "2024-02-01" }), { wrapper: localWrapper });
    await waitFor(() => expect(result.current.phase).toBe("done"));

    // Returning to the list must fetch its new last-known state despite infinite stale time.
    expect(await client.fetchQuery(listQuery)).toEqual([]);
    expect(loadAttention).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(otherBudgetKey)?.isInvalidated).toBe(false);
    unmount();
    client.clear();
  });

  it("waits for the loan account without consuming the automatic refresh attempt", async () => {
    preview.mockResolvedValue(ok);
    const { result, rerender } = renderHook(({ ready }) => useBackgroundRefresh({ debt: ready ? debt : { ...fixture, debt: { ...fixture.debt, liabilityAccountId: null } } as never, directory, from: "2024-01-01", to: "2024-02-01" }), { wrapper, initialProps: { ready: false } });
    expect(preview).not.toHaveBeenCalled();
    rerender({ ready: true });
    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("blocks planning when sync fails", async () => {
    transport.sync.mockRejectedValueOnce(new Error("sync failed"));
    const { result } = renderHook(() => useBackgroundRefresh({ debt, directory, from: "2024-01-01", to: "2024-02-01" }), { wrapper });
    await waitFor(() => expect(result.current.phase).toBe("failed"));
    expect(result.current.error).toBe("sync failed");
    expect(preview).not.toHaveBeenCalled();
  });

  it("reads fresh offset evidence after sync instead of using pre-sync history", async () => {
    let synced = false;
    transport.sync.mockImplementationOnce(async () => { synced = true; });
    const fresh = [{ accountId: "offset", asOfDate: "2024-02-01", transactionCount: 1, points: [{ date: "2024-02-01", totalBalanceMinor: 1234, clearedBalanceMinor: 1234 }] }];
    jest.mocked(readOffsetHistories).mockImplementationOnce(async () => { expect(synced).toBe(true); return { ok: true, snapshots: fresh }; });
    preview.mockResolvedValue(ok);
    const refreshed = await runLoanRefresh({ connection: { id: "c", baseUrl: "http://x", budgetSyncId: "b" } as never, debt: { ...fixture, offsets: [{ actualAccountId: "offset", useActualBalance: true }] } as never, directory, from: "2024-01-01", to: "2024-02-01", offsetHistories: [] });
    expect(preview).toHaveBeenCalledWith("d1", expect.objectContaining({ offsetHistories: fresh }));
    expect(refreshed.offsetHistories).toEqual(fresh);
  });

  it("finds a linked child inside its moved split parent instead of reporting the child missing", async () => {
    jest.mocked(postingsApi.listPostings).mockResolvedValueOnce([{ status: "applied", postingKind: "repayment-link", actualIds: ["child", "counterpart"], output: { kind: "link", sourceBefore: { id: "child", parentId: "parent", accountId: "checking", date: "2024-01-29" }, counterpartBefore: { id: "counterpart", parentId: null, accountId: "loan", date: "2024-01-29" } } }] as never);
    transport.queryTransactionsForSync.mockResolvedValueOnce([{ id: "parent", accountId: "checking", date: "2024-05-01", amount: -100, isParent: true, isChild: false, parentId: null, payeeId: null, payeeName: null, categoryId: null, notes: null, cleared: true, reconciled: false, importedId: null, importedPayee: null, transferId: null, splitLines: [{ id: "child", parentId: "parent", amount: -100, payeeId: null, categoryId: null, notes: null, transferId: "counterpart" }] }]);
    preview.mockResolvedValue(ok);
    await runLoanRefresh({ connection: { id: "c", baseUrl: "http://x", budgetSyncId: "b" } as never, debt, directory, from: "2024-01-01", to: "2024-02-01" });
    expect(transport.queryTransactionsForSync).toHaveBeenCalledWith({ ids: expect.arrayContaining(["parent", "child", "counterpart"]), resolveNames: false });
    expect(preview).toHaveBeenCalledWith("d1", expect.objectContaining({ verifiedMissingIds: ["counterpart"] }));
  });

  it("a refresh asked for while one runs is kept and runs right after, never dropped", async () => {
    let release!: () => void;
    preview.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(ok); })).mockResolvedValue(ok);
    const { result } = renderHook(() => useBackgroundRefresh({ debt, directory, from: "2024-01-01", to: "2024-02-01" }), { wrapper });
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    await act(async () => { void result.current.refresh(); });
    expect(preview).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  });

  it("does not restart queued refresh after leaving the workspace", async () => {
    let release!: () => void;
    preview.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(ok); })).mockResolvedValue(ok);
    const { result, unmount } = renderHook(() => useBackgroundRefresh({ debt, directory, from: "2024-01-01", to: "2024-02-01" }), { wrapper });
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    await act(async () => { void result.current.refresh(); });
    unmount();
    await act(async () => { release(); });
    expect(preview).toHaveBeenCalledTimes(1);
  });

});
