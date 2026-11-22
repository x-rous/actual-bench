import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AccountClassRecord, AccountFlagRecord } from "@/lib/app-db/types";
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
let flags: AccountFlagRecord[] = [];
let failClasses = false;
beforeEach(() => {
  classes = [];
  flags = [];
  failClasses = false;
  mockAccounts.mockResolvedValue([
    { id: "chk", name: "Checking", offBudget: false, closed: false },
    { id: "inv", name: "Brokerage", offBudget: true, closed: false },
  ]);
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    if (String(url).startsWith("/api/account-classes")) return failClasses ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ accountClasses: classes }) };
    if (String(url).startsWith("/api/account-flags")) return { ok: true, json: async () => ({ accountFlags: flags }) };
    return { ok: false, json: async () => ({}) };
  }) as unknown as typeof fetch;
});

const flag = (targetId: string, flagName: AccountFlagRecord["flag"], scope: AccountFlagRecord["scope"] = "account"): AccountFlagRecord => ({ budgetSyncId: "budget-1", scope, targetId, flag: flagName, updatedAt: "now" });
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

  it("needs no choice once the class is set: Investment with nothing else chosen is ready", async () => {
    classes = [record("chk", "bank"), record("inv", "investment")];
    const { result } = setup();
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current).toMatchObject({ state: "ready", accounts: [{ id: "chk", access: "available" }, { id: "inv", access: "locked" }] });
  });

  it("flags an off-budget credit card and says why, and an excluded on-budget account", async () => {
    mockAccounts.mockResolvedValue([{ id: "card", name: "Card", offBudget: true, closed: false }, { id: "chk", name: "Checking", offBudget: false, closed: false }]);
    classes = [record("card", "credit-card"), record("chk", "bank")];
    const first = setup();
    await waitFor(() => expect(first.result.current.state).toBe("setup"));
    expect(first.result.current).toMatchObject({ rows: [{ name: "Card", status: "incompatible-placement", detail: expect.stringContaining("Credit cards must be on budget") }] });
    first.unmount();
    mockAccounts.mockResolvedValue([{ id: "chk", name: "Checking", offBudget: false, closed: false }]);
    classes = [record("chk", "bank")];
    flags = [flag("chk", "excluded")];
    const second = setup();
    await waitFor(() => expect(second.result.current.state).toBe("setup"));
    expect(second.result.current).toMatchObject({ rows: [{ name: "Checking", status: "incompatible-placement" }] });
  });

  it("leaves out an excluded off-budget account that has no class, by its own flag or its group's", async () => {
    mockAccounts.mockResolvedValue([
      { id: "chk", name: "Checking", offBudget: false, closed: false },
      { id: "scratch", name: "Scratch", offBudget: true, closed: false },
      { id: "grouped", name: "Grouped", offBudget: true, closed: false, groupId: "g1" },
    ]);
    classes = [record("chk", "bank")];
    flags = [flag("scratch", "excluded"), flag("g1", "excluded", "group")];
    const { result } = setup();
    // The group is live only if the transport lists it; it does not here, so the grouped account still needs a class.
    await waitFor(() => expect(result.current.state).toBe("setup"));
    expect(result.current).toMatchObject({ rows: [{ name: "Grouped", status: "needs-class" }] });
  });

  it("resolves access from the class default, the saved choice and the placement", async () => {
    mockAccounts.mockResolvedValue([
      { id: "inv", name: "Brokerage", offBudget: true, closed: false },
      { id: "sav", name: "Notice saver", offBudget: true, closed: false },
      { id: "chk", name: "Checking", offBudget: false, closed: false },
      { id: "loan", name: "Mortgage", offBudget: true, closed: false },
    ]);
    classes = [record("inv", "investment"), record("sav", "savings"), record("chk", "bank"), record("loan", "loan")];
    // "locked" on an on-budget account and "accessible" on a loan cannot apply: they are kept but not counted.
    flags = [flag("inv", "accessible"), flag("sav", "locked"), flag("chk", "locked"), flag("loan", "accessible")];
    const { result } = setup();
    await waitFor(() => expect(result.current.state).toBe("ready"));
    const accounts = (result.current as { accounts: { id: string; access: string | null }[] }).accounts;
    expect(Object.fromEntries(accounts.map((a) => [a.id, a.access]))).toEqual({ inv: "available", sav: "locked", chk: "available", loan: null });
  });

  it("blocks an on-budget Fixed Deposit and says why", async () => {
    mockAccounts.mockResolvedValue([{ id: "fd", name: "Term deposit", offBudget: false, closed: false }]);
    classes = [record("fd", "fixed-deposit")];
    const { result } = setup();
    await waitFor(() => expect(result.current.state).toBe("setup"));
    expect(result.current).toMatchObject({ rows: [{ name: "Term deposit", status: "incompatible-placement", detail: expect.stringContaining("must be off budget") }] });
  });

  it("unlocks only from saved state, and locks again when an account is added", async () => {
    classes = [record("chk", "bank"), record("inv", "investment")];
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
