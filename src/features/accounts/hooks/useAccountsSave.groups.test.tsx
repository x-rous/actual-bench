import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAccountsSave } from "./useAccountsSave";
import { useStagedStore } from "../../../store/staged";
import type { ActualBenchTransport } from "../../../lib/actual";

/**
 * Account groups ride on the account save: groups are created and renamed
 * first (accounts need real group ids), accounts are written next, and group
 * deletes run last. These pin that order and what happens when a step fails.
 */

const mockGetTransport = jest.fn();

jest.mock("../../../lib/actual", () => {
  const actualTransport = jest.requireActual("../../../lib/actual/transport") as typeof import("../../../lib/actual/transport");
  return {
    getTransport: (connection: unknown) => (mockGetTransport as jest.Mock)(connection),
    settleTransportWrites: actualTransport.settleTransportWrites,
    syncTransportAfterChanges: jest.fn(async () => undefined),
  };
});

jest.mock("../../../store/connection", () => ({
  useConnectionStore: jest.fn(() => ({
    id: "conn-1",
    label: "HTTP API",
    mode: "http-api",
    baseUrl: "https://api.example.com",
    apiKey: "key",
    budgetSyncId: "budget-1",
  })),
  selectActiveInstance: jest.fn(),
}));

type Calls = string[];

function makeTransport(calls: Calls, overrides: Record<string, unknown> = {}) {
  return {
    mode: "http-api",
    sync: jest.fn(async () => undefined),
    createAccount: jest.fn(async (input) => {
      calls.push(`createAccount:${input.name}`);
      return { id: "server-account-1", ...input };
    }),
    updateAccount: jest.fn(async (id, patch) => {
      calls.push(`updateAccount:${id}:${JSON.stringify(patch)}`);
    }),
    deleteAccount: jest.fn(async () => undefined),
    createAccountGroup: jest.fn(async (input) => {
      calls.push(`createGroup:${input.name}`);
      return { id: "server-group-1", name: input.name };
    }),
    updateAccountGroup: jest.fn(async (id, patch) => {
      calls.push(`updateGroup:${id}:${patch.name}`);
    }),
    deleteAccountGroup: jest.fn(async (id) => {
      calls.push(`deleteGroup:${id}`);
    }),
    ...overrides,
  } as unknown as ActualBenchTransport;
}

function renderSave() {
  const client = new QueryClient();
  return renderHook(() => useAccountsSave(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

const store = () => useStagedStore.getState();

function loadServerState() {
  store().loadAccounts([
    { id: "a1", name: "Checking", offBudget: false, closed: false, groupId: "g1" },
    { id: "a2", name: "Cash", offBudget: false, closed: false, groupId: null },
  ]);
  store().loadAccountGroups([
    { id: "g1", name: "Everyday" },
    { id: "g2", name: "Savings" },
  ]);
}

describe("useAccountsSave with account groups", () => {
  beforeEach(() => {
    store().discardAll();
    mockGetTransport.mockReset();
  });
  afterEach(() => store().discardAll());

  it("counts a staged group change as a pending change", () => {
    loadServerState();
    store().stageNew("accountGroups", { id: "tmp-g", name: "New" });
    const { result } = renderSave();
    expect(result.current.hasPendingChanges).toBe(true);
  });

  it("creates a new group before the account that uses it, then assigns the new account", async () => {
    const calls: Calls = [];
    mockGetTransport.mockReturnValue(makeTransport(calls));
    loadServerState();
    store().stageNew("accountGroups", { id: "tmp-g", name: "Brokerage" });
    store().stageNew("accounts", { id: "tmp-a", name: "ETF", offBudget: true, closed: false, groupId: "tmp-g" });

    const { result } = renderSave();
    let summary!: Awaited<ReturnType<typeof result.current.save>>;
    await act(async () => {
      summary = await result.current.save();
    });

    expect(calls).toEqual([
      "createGroup:Brokerage",
      "createAccount:ETF",
      // The create call has no group field, so the group is a follow-up write.
      'updateAccount:server-account-1:{"groupId":"server-group-1"}',
    ]);
    expect(summary.failed).toEqual([]);
    expect(summary.idMap).toMatchObject({ "tmp-g": "server-group-1", "tmp-a": "server-account-1" });
    expect(store().accountGroups["tmp-g"]).toBeUndefined();
  });

  it("sends the group only for accounts whose group changed", async () => {
    const calls: Calls = [];
    mockGetTransport.mockReturnValue(makeTransport(calls));
    loadServerState();
    store().stageUpdate("accounts", "a1", { name: "Checking 2" }); // group untouched
    store().stageUpdate("accounts", "a2", { groupId: "g2" }); // assigned

    const { result } = renderSave();
    await act(async () => {
      await result.current.save();
    });

    expect(calls).toEqual([
      'updateAccount:a1:{"name":"Checking 2","offBudget":false,"closed":false}',
      'updateAccount:a2:{"name":"Cash","offBudget":false,"closed":false,"groupId":"g2"}',
    ]);
  });

  it("un-assigns with a null group id", async () => {
    const calls: Calls = [];
    mockGetTransport.mockReturnValue(makeTransport(calls));
    loadServerState();
    store().stageUpdate("accounts", "a1", { groupId: null });

    const { result } = renderSave();
    await act(async () => {
      await result.current.save();
    });

    expect(calls[0]).toContain('"groupId":null');
  });

  it("renames groups first and deletes groups last, after accounts have moved off them", async () => {
    const calls: Calls = [];
    mockGetTransport.mockReturnValue(makeTransport(calls));
    loadServerState();
    store().stageUpdate("accountGroups", "g2", { name: "Savings & Goals" });
    store().stageUpdate("accounts", "a1", { groupId: "g2" });
    store().stageDelete("accountGroups", "g1");

    const { result } = renderSave();
    await act(async () => {
      await result.current.save();
    });

    expect(calls[0]).toBe("updateGroup:g2:Savings & Goals");
    expect(calls[1]).toContain("updateAccount:a1");
    expect(calls[calls.length - 1]).toBe("deleteGroup:g1");
  });

  it("fails an account whose new group could not be created, and keeps it staged for retry", async () => {
    const calls: Calls = [];
    mockGetTransport.mockReturnValue(
      makeTransport(calls, {
        createAccountGroup: jest.fn(async () => {
          throw new Error("duplicate name");
        }),
      })
    );
    loadServerState();
    store().stageNew("accountGroups", { id: "tmp-g", name: "Dup" });
    store().stageUpdate("accounts", "a2", { groupId: "tmp-g" });

    const { result } = renderSave();
    let summary!: Awaited<ReturnType<typeof result.current.save>>;
    await act(async () => {
      summary = await result.current.save();
    });

    // The group failed and the account that depends on it was not written.
    expect(summary.failed.map((f) => f.id).sort()).toEqual(["a2", "tmp-g"]);
    expect(calls.some((c) => c.startsWith("updateAccount:a2"))).toBe(false);
    expect(store().accountGroups["tmp-g"]?.saveError).toMatch(/duplicate name/);
    expect(store().accounts["a2"]?.saveError).toMatch(/group could not be created/i);
    expect(store().accounts["a2"]?.isUpdated).toBe(true);
  });

  it("reports a created account whose group assignment failed, without losing the account", async () => {
    const calls: Calls = [];
    mockGetTransport.mockReturnValue(
      makeTransport(calls, {
        updateAccount: jest.fn(async () => {
          throw new Error("boom");
        }),
      })
    );
    loadServerState();
    store().stageNew("accounts", { id: "tmp-a", name: "ETF", offBudget: true, closed: false, groupId: "g1" });

    const { result } = renderSave();
    let summary!: Awaited<ReturnType<typeof result.current.save>>;
    await act(async () => {
      summary = await result.current.save();
    });

    expect(summary.succeeded.map((s) => s.id)).toContain("tmp-a");
    expect(summary.failed).toEqual([
      expect.objectContaining({ id: "server-account-1", message: expect.stringContaining("Account created, but") }),
    ]);
  });

  it("never sends a group field to a transport without account groups", async () => {
    const calls: Calls = [];
    const transport = makeTransport(calls, {
      createAccountGroup: undefined,
      updateAccountGroup: undefined,
      deleteAccountGroup: undefined,
    });
    mockGetTransport.mockReturnValue(transport);
    store().loadAccounts([{ id: "a1", name: "Checking", offBudget: false, closed: false, groupId: null }]);
    store().stageUpdate("accounts", "a1", { name: "Renamed" });

    const { result } = renderSave();
    await act(async () => {
      await result.current.save();
    });

    expect(calls).toEqual(['updateAccount:a1:{"name":"Renamed","offBudget":false,"closed":false}']);
  });
});
