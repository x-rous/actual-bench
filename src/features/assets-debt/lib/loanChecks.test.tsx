import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useBackgroundLoanChecks } from "./loanChecks";
import * as refresh from "../components/workspace/useBackgroundRefresh";
import * as api from "./debtsApi";

jest.mock("@/store/connection", () => ({ selectActiveInstance: (s: unknown) => s, useConnectionStore: () => ({ id: "c", baseUrl: "http://x", budgetSyncId: "b" }) }));
jest.mock("./useAccountDirectory", () => ({ useAccountDirectory: () => ({ data: { budgetSyncId: "b", accounts: [], categories: [] } }) }));
jest.mock("./debtsApi", () => ({ getDebt: jest.fn() }));
jest.mock("../components/workspace/useBackgroundRefresh", () => ({ runLoanRefresh: jest.fn(async () => ({})), loanStatusKey: () => "k" }));
const run = refresh.runLoanRefresh as jest.Mock;
const getDebt = api.getDebt as jest.Mock;

const summary = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, status: "active", blocked: null, paidOffOn: null, liabilityAccountId: "loan", ...extra }) as never;
const detail = (id: string, offsets: unknown[] = []) => ({ debt: { id, currentRevision: 1 }, offsets, config: { ok: true, config: { terms: { openingDate: "2024-01-01" } } } });
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

/** The loans list reads each active loan from Actual on its own (owner decision 2026-10-07). */
describe("background loan checks", () => {
  beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); getDebt.mockImplementation(async (id: string) => detail(id, id === "offset" ? [{}] : [])); });

  it("re-plans each active loan once, skipping archived, paid off and offset loans, and not again within 10 minutes", async () => {
    const debts = [summary("a"), summary("b", { status: "archived" }), summary("c", { paidOffOn: "2024-05-01" }), summary("offset")];
    const first = renderHook(() => useBackgroundLoanChecks(debts), { wrapper });
    await waitFor(() => expect(first.result.current.checking).toBeNull());
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0][0]).toMatchObject({ from: "2024-01-01", debt: { debt: { id: "a" } } });
    first.unmount();
    run.mockClear();
    const again = renderHook(() => useBackgroundLoanChecks(debts), { wrapper });
    await waitFor(() => expect(again.result.current.checking).toBeNull());
    expect(run).not.toHaveBeenCalled();
  });
});
