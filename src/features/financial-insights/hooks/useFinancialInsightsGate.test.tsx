import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AccountClassRecord, AccountReportingRecord } from "@/lib/app-db/types";
import { useFinancialInsightsGate } from "./useFinancialInsights";

jest.mock("../../../store/connection", () => ({
  useConnectionStore: jest.fn(() => ({ id: "conn-1", budgetSyncId: "budget-1" })),
  selectActiveInstance: jest.fn(),
}));
const mockAccounts = jest.fn();
jest.mock("@/lib/actual", () => ({
  getTransport: () => ({ getAccounts: mockAccounts, getAccountGroups: async () => [] }),
}));
jest.mock("@/lib/api/query", () => ({ runQuery: jest.fn(async () => ({ data: [] })) }));

let classes: AccountClassRecord[] = [];
let reporting: AccountReportingRecord[] = [];
let failClasses = false;
beforeEach(() => {
  classes = [];
  reporting = [];
  failClasses = false;
  mockAccounts.mockResolvedValue([
    { id: "chk", name: "Checking", offBudget: false, closed: false },
    { id: "inv", name: "Brokerage", offBudget: true, closed: false },
  ]);
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    if (String(url).startsWith("/api/account-classes")) return failClasses ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ accountClasses: classes }) };
    return { ok: true, json: async () => ({ accountReporting: reporting }) };
  }) as unknown as typeof fetch;
});

const record = (accountId: string, accountClass: AccountClassRecord["accountClass"]): AccountClassRecord => ({ budgetSyncId: "budget-1", scope: "account", accountId, accountClass, updatedAt: "now" });

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useFinancialInsightsGate(), { wrapper }) };
}

describe("Financial Insights gate", () => {
  it("shows no figures while it checks, and lists exactly what is missing", async () => {
    const { result } = setup();
    expect(result.current.state).toBe("loading");
    await waitFor(() => expect(result.current.state).toBe("setup"));
    expect(result.current).toMatchObject({ state: "setup", rows: [{ name: "Checking", status: "needs-class" }, { name: "Brokerage", status: "needs-class" }] });
  });

  it("still asks for the required choice once the class is set", async () => {
    classes = [record("chk", "bank"), record("inv", "investment")];
    const { result } = setup();
    await waitFor(() => expect(result.current.state).toBe("setup"));
    expect(result.current).toMatchObject({ rows: [{ name: "Brokerage", status: "needs-choice" }] });
  });

  it("unlocks only from saved state, and locks again when an account is added", async () => {
    classes = [record("chk", "bank"), record("inv", "investment")];
    reporting = [{ budgetSyncId: "budget-1", accountId: "inv", treatment: "non-current-investment", updatedAt: "now" }];
    const { result, client } = setup();
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current).toMatchObject({ state: "ready", accounts: [{ id: "chk", accountClass: "bank" }, { id: "inv", accountClass: "investment" }] });

    mockAccounts.mockResolvedValue([
      { id: "chk", name: "Checking", offBudget: false, closed: false },
      { id: "inv", name: "Brokerage", offBudget: true, closed: false },
      { id: "new", name: "New account", offBudget: false, closed: false },
    ]);
    await act(async () => { await client.invalidateQueries({ queryKey: ["accounts"] }); });
    await waitFor(() => expect(result.current.state).toBe("setup"));
    expect(result.current).toMatchObject({ rows: [{ name: "New account", status: "needs-class" }] });
  });

  it("ignores a closed account that never had a transaction", async () => {
    mockAccounts.mockResolvedValue([{ id: "chk", name: "Checking", offBudget: false, closed: false }, { id: "old", name: "Old", offBudget: false, closed: true }]);
    classes = [record("chk", "bank")];
    const { result } = setup();
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current).toMatchObject({ accounts: [{ id: "chk" }] });
  });

  it("stays locked, with a retry, when the saved classes cannot be read", async () => {
    failClasses = true;
    const { result } = setup();
    await waitFor(() => expect(result.current.state).toBe("error"));
  });
});
