import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AccountClassRecord } from "@/lib/app-db/types";
import type { AccountClassChange } from "@/lib/account-class";
import { useAccountClasses } from "./useAccountClasses";

jest.mock("../../../store/connection", () => ({
  useConnectionStore: jest.fn(() => ({ id: "conn-1", budgetSyncId: "budget-1" })),
  selectActiveInstance: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

/** A tiny in-memory stand-in for /api/account-classes. */
function fakeServer() {
  const rows = new Map<string, AccountClassRecord>();
  const body = () => ({ ok: true, json: async () => ({ accountClasses: [...rows.values()] }) });
  const get = jest.fn(async () => body());
  const put = jest.fn(async (changes: AccountClassChange[]) => {
    for (const c of changes) {
      const key = `${c.scope}:${c.id}`;
      if (c.accountClass) rows.set(key, { budgetSyncId: "budget-1", scope: c.scope, accountId: c.id, accountClass: c.accountClass, updatedAt: "now" });
      else rows.delete(key);
    }
    return body();
  });
  global.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "PUT" ? put((JSON.parse(String(init.body)) as { changes: AccountClassChange[] }).changes) : get()
  ) as unknown as typeof fetch;
  return { get, put };
}

describe("useAccountClasses", () => {
  it("shows a class saved by one component in every other component using it, without a refetch", async () => {
    const server = fakeServer();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

    // The accounts table and the Groups dialog each call the hook.
    const table = renderHook(() => useAccountClasses(), { wrapper });
    await waitFor(() => expect(table.result.current.available).toBe(true));
    const dialog = renderHook(() => useAccountClasses(), { wrapper });
    await waitFor(() => expect(dialog.result.current.available).toBe(true));

    act(() => dialog.result.current.apply([{ scope: "group", id: "g1", accountClass: "bank" }]));

    await waitFor(() => expect(table.result.current.maps.groups.get("g1")).toBe("bank"));
    expect(server.get).toHaveBeenCalledTimes(1);
  });
});
