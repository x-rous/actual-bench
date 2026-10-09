import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AccountClassRecord } from "@/lib/app-db/types";
import type { AccountClassChange } from "@/lib/account-class";
import { useAccountClasses } from "./useAccountClasses";

let mockBudgetSyncId = "budget-1";
jest.mock("../../../store/connection", () => ({
  useConnectionStore: jest.fn(() => ({ id: "conn-1", budgetSyncId: mockBudgetSyncId })),
  selectActiveInstance: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

/**
 * A tiny in-memory stand-in for /api/account-classes, one list per budget.
 * With `holdPut`, a PUT stays in flight until `releasePut` is called.
 */
function fakeServer({ holdPut = false } = {}) {
  const budgets = new Map<string, Map<string, AccountClassRecord>>();
  const rowsOf = (budget: string) => {
    if (!budgets.has(budget)) budgets.set(budget, new Map());
    return budgets.get(budget)!;
  };
  const body = (budget: string) => ({ ok: true, json: async () => ({ accountClasses: [...rowsOf(budget).values()] }) });
  const get = jest.fn(async (budget: string) => body(budget));
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const put = jest.fn(async (budget: string, changes: AccountClassChange[]) => {
    if (holdPut) await gate;
    for (const c of changes) {
      const key = `${c.scope}:${c.id}`;
      if (c.accountClass) rowsOf(budget).set(key, { budgetSyncId: budget, scope: c.scope, accountId: c.id, accountClass: c.accountClass, updatedAt: "now" });
      else rowsOf(budget).delete(key);
    }
    return body(budget);
  });
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const { budgetSyncId, changes } = JSON.parse(String(init.body)) as { budgetSyncId: string; changes: AccountClassChange[] };
      return put(budgetSyncId, changes);
    }
    return get(new URL(String(url), "http://localhost").searchParams.get("budgetSyncId") ?? "");
  }) as unknown as typeof fetch;
  return { get, put, releasePut: () => release() };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe("useAccountClasses", () => {
  beforeEach(() => {
    mockBudgetSyncId = "budget-1";
  });

  it("shows a class saved by one component in every other component using it, without a refetch", async () => {
    const server = fakeServer();
    const { wrapper } = setup();

    // The accounts table and the Groups dialog each call the hook.
    const table = renderHook(() => useAccountClasses(), { wrapper });
    await waitFor(() => expect(table.result.current.available).toBe(true));
    const dialog = renderHook(() => useAccountClasses(), { wrapper });
    await waitFor(() => expect(dialog.result.current.available).toBe(true));

    act(() => dialog.result.current.apply([{ scope: "group", id: "g1", accountClass: "bank" }]));

    await waitFor(() => expect(table.result.current.maps.groups.get("g1")).toBe("bank"));
    expect(server.get).toHaveBeenCalledTimes(1);
  });

  it("puts a save that finishes after a budget switch in the cache of the budget it was saved for", async () => {
    const server = fakeServer({ holdPut: true });
    const { client, wrapper } = setup();

    const hook = renderHook(() => useAccountClasses(), { wrapper });
    await waitFor(() => expect(hook.result.current.available).toBe(true));

    act(() => hook.result.current.apply([{ scope: "account", id: "a1", accountClass: "cash" }]));
    await waitFor(() => expect(server.put).toHaveBeenCalledWith("budget-1", expect.anything()));

    // Switch to another budget while the save is still in flight.
    mockBudgetSyncId = "budget-2";
    hook.rerender();
    await waitFor(() => expect(client.getQueryData(["accountClasses", "budget-2"])).toEqual([]));

    await act(async () => server.releasePut());

    await waitFor(() => expect(client.getQueryData<AccountClassRecord[]>(["accountClasses", "budget-1"])).toHaveLength(1));
    expect(client.getQueryData(["accountClasses", "budget-2"])).toEqual([]);
    expect(hook.result.current.maps.accounts.size).toBe(0);
  });

  it("does not save when no budget is open", () => {
    const server = fakeServer();
    mockBudgetSyncId = "";
    const { wrapper } = setup();
    const hook = renderHook(() => useAccountClasses(), { wrapper });

    act(() => hook.result.current.apply([{ scope: "account", id: "a1", accountClass: "cash" }]));

    expect(server.put).not.toHaveBeenCalled();
  });
});
