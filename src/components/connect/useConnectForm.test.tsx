import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConnectForm } from "./useConnectForm";
import { useConnectionStore, type ConnectionInstance } from "@/store/connection";
import { useSavedServersStore } from "@/store/savedServers";
import { useStagedStore } from "@/store/staged";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockEnsureTransportReady = jest.fn();
const mockGetTransport = jest.fn();
const mockListBudgets = jest.fn();
const mockTestConnection = jest.fn();
const mockGetApiVersion = jest.fn();
const mockGetServerVersion = jest.fn();
const mockLoadBrowserApiBudgetList = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../lib/api/client", () => ({
  listBudgets: (baseUrl: string, apiKey: string) => mockListBudgets(baseUrl, apiKey),
  testConnection: (connection: unknown) => mockTestConnection(connection),
  getApiVersion: (baseUrl: string, apiKey: string) => mockGetApiVersion(baseUrl, apiKey),
  getServerVersion: (baseUrl: string, apiKey: string, budgetSyncId?: string) =>
    mockGetServerVersion(baseUrl, apiKey, budgetSyncId),
}));

jest.mock("../../lib/actual", () => ({
  ensureTransportReady: (connection: unknown) => mockEnsureTransportReady(connection),
  getTransport: (connection: unknown) => mockGetTransport(connection),
}));

jest.mock("../../lib/actual/browser/labRuntime", () => ({
  listBrowserApiBudgets: jest.fn(),
  loadBrowserApiBudgetList: (input: unknown) => mockLoadBrowserApiBudgetList(input),
}));

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function resetStores() {
  useConnectionStore.getState().clearAll();
  useSavedServersStore.getState().clearServers();
  useStagedStore.getState().discardAll();
}

describe("useConnectForm Direct redirects", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockReplace.mockReset();
    mockEnsureTransportReady.mockReset().mockResolvedValue(undefined);
    mockListBudgets.mockReset();
    mockTestConnection.mockReset().mockResolvedValue(undefined);
    mockGetApiVersion.mockReset().mockResolvedValue(null);
    mockGetServerVersion.mockReset().mockResolvedValue(null);
    mockGetTransport.mockReset().mockReturnValue({
      getServerVersion: jest.fn().mockResolvedValue(null),
    });
    mockLoadBrowserApiBudgetList.mockReset();

    resetStores();
    sessionStorage.clear();
  });

  afterEach(() => {
    act(() => {
      resetStores();
    });
  });

  it("redirects a successful Direct budget connection to overview", async () => {
    mockLoadBrowserApiBudgetList.mockResolvedValue({
      budgets: [{ groupId: "budget-1", name: "Budget One" }],
      serverVersion: "25.1.0",
    });

    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      result.current.handleModeChange("browser-api");
      result.current.setBaseUrl("https://actual.example.com");
      result.current.setServerPassword("password");
    });

    act(() => {
      result.current.handleValidate();
    });

    await waitFor(() => expect(result.current.budgets).toHaveLength(1));
    expect(result.current.showManualForm).toBe(false);

    act(() => {
      result.current.handleConnect();
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/overview"), { timeout: 2_000 });
    expect(mockPush).not.toHaveBeenCalledWith("/accounts");
    const [savedServer] = useSavedServersStore.getState().servers;
    expect(savedServer).toEqual(
      expect.objectContaining({
        mode: "browser-api",
        label: "actual.example.com",
        baseUrl: "https://actual.example.com",
      })
    );
    expect(savedServer).not.toHaveProperty("serverPassword");
  });

  it("hides server fields after HTTP API budgets load", async () => {
    mockListBudgets.mockResolvedValue([
      { groupId: "budget-1", cloudFileId: "budget-1", name: "Budget One" },
    ]);
    mockGetApiVersion.mockResolvedValue("1.2.3");

    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      result.current.setBaseUrl("https://api.example.com");
      result.current.setApiKey("api-key");
    });

    act(() => {
      result.current.handleValidate();
    });

    await waitFor(() => expect(result.current.budgets).toHaveLength(1));
    expect(result.current.showManualForm).toBe(false);
  });

  it("selects a saved Direct server as URL prefill without restoring or validating a password", () => {
    useSavedServersStore.getState().addServer({
      mode: "browser-api",
      label: "actual.example.com",
      baseUrl: "https://actual.example.com",
    });
    const [server] = useSavedServersStore.getState().servers;

    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      result.current.handleSelectServer(server);
    });

    expect(result.current.connectionMode).toBe("browser-api");
    expect(result.current.selectedServerId).toBe(server.id);
    expect(result.current.baseUrl).toBe("https://actual.example.com");
    expect(result.current.serverPassword).toBe("");
    expect(result.current.budgets).toBeNull();
    expect(mockLoadBrowserApiBudgetList).not.toHaveBeenCalled();
  });

  it("reuses an in-memory Direct password when selecting the same saved server", async () => {
    mockLoadBrowserApiBudgetList.mockResolvedValue({
      budgets: [{ groupId: "budget-2", name: "Budget Two" }],
      serverVersion: "25.1.0",
    });
    useConnectionStore.getState().addInstance({
      id: "direct-1",
      mode: "browser-api",
      label: "Budget One",
      baseUrl: "https://actual.example.com",
      serverPassword: "password",
      budgetSyncId: "budget-1",
    });
    useSavedServersStore.getState().addServer({
      mode: "browser-api",
      label: "actual.example.com",
      baseUrl: "https://actual.example.com",
    });
    const [server] = useSavedServersStore.getState().servers;

    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      result.current.handleSelectServer(server);
    });

    expect(result.current.serverPassword).toBe("password");
    await waitFor(() => expect(result.current.budgets).toHaveLength(1));
    expect(mockLoadBrowserApiBudgetList).toHaveBeenCalledWith({
      serverUrl: "https://actual.example.com",
      serverPassword: "password",
    });
  });

  it("allows a Direct budget that exposes id instead of groupId", async () => {
    mockLoadBrowserApiBudgetList.mockResolvedValue({
      budgets: [{ id: "local-budget-1", name: "Local Budget", state: "remote" }],
      serverVersion: "25.1.0",
    });

    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      result.current.handleModeChange("browser-api");
      result.current.setBaseUrl("https://actual.example.com");
      result.current.setServerPassword("password");
    });

    act(() => {
      result.current.handleValidate();
    });

    await waitFor(() => expect(result.current.budgets).toHaveLength(1));
    expect(result.current.selectedGroupId).toBe("local-budget-1");

    act(() => {
      result.current.handleConnect();
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/overview"), { timeout: 2_000 });
    expect(mockEnsureTransportReady).toHaveBeenCalledWith(
      expect.objectContaining({ budgetSyncId: "local-budget-1" })
    );
  });

  it("redirects a successful Direct reconnect to overview", async () => {
    const instance: ConnectionInstance = {
      id: "direct-1",
      mode: "browser-api",
      label: "Direct Budget",
      baseUrl: "https://actual.example.com",
      serverPassword: "password",
      budgetSyncId: "budget-1",
    };
    useConnectionStore.getState().addInstance(instance);

    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), {
      wrapper: makeWrapper(client),
    });

    act(() => {
      result.current.handleReconnect(instance);
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/overview"), { timeout: 2_000 });
    expect(mockPush).not.toHaveBeenCalledWith("/accounts");
  });
});
