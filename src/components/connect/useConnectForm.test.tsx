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
  listBudgets: jest.fn(),
  testConnection: jest.fn(),
  getApiVersion: jest.fn(),
  getServerVersion: jest.fn(),
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

    act(() => {
      result.current.handleConnect();
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/overview"), { timeout: 2_000 });
    expect(mockPush).not.toHaveBeenCalledWith("/accounts");
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
