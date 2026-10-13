import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAccountsSave } from "./useAccountsSave";
import { useStagedStore } from "../../../store/staged";
import type { ActualBenchTransport } from "../../../lib/actual";
import type { ConnectionInstance } from "../../../store/connection";
import type { AccountClass } from "@/lib/account-class";

const mockGetTransport = jest.fn();
const mockSyncTransportAfterChanges = jest.fn(
  async (transport: ActualBenchTransport, changed: boolean) => {
    if (changed && transport.mode === "browser-api") await transport.sync();
  }
);

jest.mock("../../../lib/actual", () => {
  const actualTransport = jest.requireActual("../../../lib/actual/transport") as typeof import("../../../lib/actual/transport");
  return {
    getTransport: (connection: unknown) => (mockGetTransport as jest.Mock)(connection),
    settleTransportWrites: actualTransport.settleTransportWrites,
    syncTransportAfterChanges: (transport: unknown, changed: unknown) =>
      (mockSyncTransportAfterChanges as jest.Mock)(transport, changed),
  };
});

let mockActiveConnection: ConnectionInstance = {
  id: "conn-1",
  label: "HTTP API",
  mode: "http-api",
  baseUrl: "https://api.example.com",
  apiKey: "key",
  budgetSyncId: "budget-1",
};

jest.mock("../../../store/connection", () => ({
  useConnectionStore: jest.fn(() => mockActiveConnection),
  selectActiveInstance: jest.fn(),
}));

function makeTransport(mode: "http-api" | "browser-api") {
  return {
    mode,
    sync: jest.fn(() => Promise.resolve()),
    createAccount: jest.fn((input) =>
      Promise.resolve({ id: "server-account-1", ...input })
    ),
    updateAccount: jest.fn(() => Promise.resolve()),
    deleteAccount: jest.fn(() => Promise.resolve()),
  } as unknown as ActualBenchTransport & {
    sync: jest.Mock;
    createAccount: jest.Mock;
  };
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function stageNewAccount(accountClass?: AccountClass) {
  useStagedStore.getState().stageNew("accounts", {
    id: "client-account-1",
    name: accountClass ? "Pension" : "New Checking",
    offBudget: Boolean(accountClass),
    closed: false,
    initialBalance: 12.34,
  });
  if (accountClass) useStagedStore.getState().stageAccountClass("client-account-1", accountClass);
}

describe("useAccountsSave", () => {
  beforeEach(() => {
    useStagedStore.getState().discardAll();
    mockGetTransport.mockReset();
    mockSyncTransportAfterChanges.mockClear();
    global.fetch = jest.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { budgetSyncId: string; changes: { scope: string; id: string; accountClass: AccountClass | null }[] };
      return { ok: true, json: async () => ({ accountClasses: body.changes.map((change) => ({
        budgetSyncId: body.budgetSyncId, scope: change.scope, accountId: change.id, accountClass: change.accountClass, updatedAt: "now",
      })) }) };
    }) as jest.Mock;
    mockActiveConnection = {
      id: "conn-1",
      label: "HTTP API",
      mode: "http-api",
      baseUrl: "https://api.example.com",
      apiKey: "key",
      budgetSyncId: "budget-1",
    };
  });

  afterEach(() => {
    useStagedStore.getState().discardAll();
  });

  it("saves HTTP API staged creates through the selected transport without Direct sync", async () => {
    const transport = makeTransport("http-api");
    mockGetTransport.mockReturnValue(transport);
    stageNewAccount();

    const client = new QueryClient();
    const { result } = renderHook(() => useAccountsSave(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.save();
    });

    expect(mockGetTransport).toHaveBeenCalledWith(mockActiveConnection);
    expect(transport.createAccount).toHaveBeenCalledWith({
      name: "New Checking",
      offBudget: false,
      closed: false,
      initialBalance: 12.34,
    });
    expect(mockSyncTransportAfterChanges).toHaveBeenCalledWith(transport, true);
    expect(transport.sync).not.toHaveBeenCalled();
  });

  it("syncs the browser transport after Direct staged creates succeed", async () => {
    mockActiveConnection = {
      id: "conn-2",
      label: "Direct",
      mode: "browser-api",
      baseUrl: "https://actual.example.com",
      serverPassword: "password",
      budgetSyncId: "budget-1",
    };
    const transport = makeTransport("browser-api");
    mockGetTransport.mockReturnValue(transport);
    stageNewAccount();

    const client = new QueryClient();
    const { result } = renderHook(() => useAccountsSave(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.save();
    });

    expect(transport.createAccount).toHaveBeenCalledTimes(1);
    expect(mockSyncTransportAfterChanges).toHaveBeenCalledWith(transport, true);
    expect(transport.sync).toHaveBeenCalledTimes(1);
  });

  it.each(["http-api", "browser-api"] as const)("saves the class against the returned id after %s creation resolves", async (mode) => {
    const transport = makeTransport(mode);
    let finishCreate!: (value: unknown) => void;
    transport.createAccount.mockImplementation(() => new Promise((resolve) => { finishCreate = resolve; }));
    mockGetTransport.mockReturnValue(transport);
    stageNewAccount("retirement");
    const client = new QueryClient();
    const { result } = renderHook(() => useAccountsSave(), { wrapper: makeWrapper(client) });
    let saving!: ReturnType<typeof result.current.save>;
    await act(async () => { saving = result.current.save(); });
    await waitFor(() => expect(transport.createAccount).toHaveBeenCalledTimes(1));
    expect(global.fetch).not.toHaveBeenCalled();
    await act(async () => {
      finishCreate({ id: "server-account-1", name: "Pension", offBudget: true, closed: false });
      await saving;
    });
    expect(transport.createAccount).toHaveBeenCalledWith({ name: "Pension", offBudget: true, closed: false, initialBalance: 12.34 });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({ budgetSyncId: "budget-1", changes: [{ scope: "account", id: "server-account-1", accountClass: "retirement" }] });
    expect(client.getQueryData(["accountClasses", "budget-1"])).toEqual([expect.objectContaining({ accountId: "server-account-1", accountClass: "retirement" })]);
    expect(useStagedStore.getState().accounts["client-account-1"]).toBeUndefined();
    expect(result.current.hasPendingChanges).toBe(false);
  });

  it("retains the selected class on a failed create without writing any class metadata", async () => {
    const transport = makeTransport("http-api");
    transport.createAccount.mockRejectedValue(new Error("Create failed"));
    mockGetTransport.mockReturnValue(transport);
    stageNewAccount("retirement");
    const { result } = renderHook(() => useAccountsSave(), { wrapper: makeWrapper(new QueryClient()) });
    await act(async () => { await result.current.save(); });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(useStagedStore.getState().accounts["client-account-1"]).toMatchObject({ isNew: true, pendingAccountClass: "retirement", saveError: "Create failed" });
  });

  it.each(["http-api", "browser-api"] as const)("retains and retries only failed class metadata after %s creation", async (mode) => {
    const transport = makeTransport(mode);
    mockGetTransport.mockReturnValue(transport);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
    stageNewAccount("retirement");
    const { result } = renderHook(() => useAccountsSave(), { wrapper: makeWrapper(new QueryClient()) });
    await act(async () => { await result.current.save(); });
    expect(useStagedStore.getState().accounts["client-account-1"]).toBeUndefined();
    expect(useStagedStore.getState().accounts["server-account-1"]).toMatchObject({ isNew: false, isUpdated: true, pendingAccountClass: "retirement", saveError: expect.stringContaining("Save again to retry the class") });
    act(() => useStagedStore.getState().loadAccounts([]));
    expect(useStagedStore.getState().accounts["server-account-1"]?.pendingAccountClass).toBe("retirement");
    await act(async () => { await result.current.save(); });
    expect(transport.createAccount).toHaveBeenCalledTimes(1);
    expect(transport.updateAccount).not.toHaveBeenCalled();
    expect(transport.sync).toHaveBeenCalledTimes(mode === "browser-api" ? 1 : 0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.current.hasPendingChanges).toBe(false);
  });

  it("does not repeat a successful Actual update when its class save needs retry", async () => {
    const transport = makeTransport("http-api");
    mockGetTransport.mockReturnValue(transport);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
    useStagedStore.getState().loadAccounts([{ id: "real", name: "Old", offBudget: true, closed: false }]);
    useStagedStore.getState().stageUpdate("accounts", "real", { name: "Renamed" });
    useStagedStore.getState().stageAccountClass("real", "retirement");
    const { result } = renderHook(() => useAccountsSave(), { wrapper: makeWrapper(new QueryClient()) });
    await act(async () => { await result.current.save(); });
    expect(useStagedStore.getState().accounts.real.original?.name).toBe("Renamed");
    await act(async () => { await result.current.save(); });
    expect(transport.updateAccount).toHaveBeenCalledTimes(1);
    expect(transport.createAccount).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves a class changed during an in-flight save under the real account id", async () => {
    const transport = makeTransport("http-api");
    mockGetTransport.mockReturnValue(transport);
    let finishClass!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finishClass = resolve; }));
    stageNewAccount("retirement");
    const { result } = renderHook(() => useAccountsSave(), { wrapper: makeWrapper(new QueryClient()) });
    let saving!: ReturnType<typeof result.current.save>;
    await act(async () => { saving = result.current.save(); });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    act(() => useStagedStore.getState().stageAccountClass("client-account-1", "investment"));
    await act(async () => {
      finishClass({ ok: true, json: async () => ({ accountClasses: [] }) });
      await saving;
    });
    expect(useStagedStore.getState().accounts["server-account-1"]).toMatchObject({ isNew: false, isUpdated: true, pendingAccountClass: "investment" });
    await act(async () => { await result.current.save(); });
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body).changes[0]).toEqual({ scope: "account", id: "server-account-1", accountClass: "investment" });
    expect(transport.createAccount).toHaveBeenCalledTimes(1);
    expect(transport.updateAccount).not.toHaveBeenCalled();
  });
});
