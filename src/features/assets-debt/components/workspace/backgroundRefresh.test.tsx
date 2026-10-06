import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useBackgroundRefresh } from "./useBackgroundRefresh";
import * as postingsApi from "../../lib/postingsApi";

const transport = { sync: jest.fn(async () => {}), getPayees: jest.fn(async () => []), canVerifyTransferLinks: undefined };
jest.mock("@/lib/actual", () => ({ getTransport: () => transport }));
jest.mock("@/store/connection", () => ({ selectActiveInstance: (s: unknown) => s, useConnectionStore: () => ({ id: "c", baseUrl: "http://x", budgetSyncId: "b" }) }));
jest.mock("@/lib/assets-debt/actual/ledgerPort", () => ({
  readAccountLedger: jest.fn(async () => ({ ok: true, transactions: [] })),
  readMatchingHistory: jest.fn(async () => []),
  datedBalanceFromTransactions: () => ({ balanceMinor: 0 }),
  toDebtMagnitude: () => -1,
}));
jest.mock("../../lib/postingsApi", () => ({ previewPostings: jest.fn() }));
jest.mock("../../lib/debtsApi", () => ({ getDebtReconciliation: jest.fn() }));
const preview = postingsApi.previewPostings as jest.Mock;

const debt = { debt: { id: "d1", liabilityAccountId: "loan", paymentAccountId: null, signConvention: "negative-is-debt", currentRevision: 1, onboardingDate: null } } as never;
const directory = { budgetSyncId: "b", accounts: [], categories: [] } as never;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const ok = { ok: true, postings: [], notices: [], driftMaterial: false };

/** Sync Repayments keeps itself current without repeated clicks (owner decision 2026-10-07). */
describe("background refresh", () => {
  beforeEach(() => { jest.clearAllMocks(); });

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

  it("coming back to the tab refreshes on its own, at most every 30 seconds", async () => {
    preview.mockResolvedValue(ok);
    const now = jest.spyOn(Date, "now");
    let clock = 1_000_000;
    now.mockImplementation(() => clock);
    renderHook(() => useBackgroundRefresh({ debt, directory, from: "2024-01-01", to: "2024-02-01" }), { wrapper });
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(preview).toHaveBeenCalledTimes(1);
    clock += 31_000;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    now.mockRestore();
  });
});
