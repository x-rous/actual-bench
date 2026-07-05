import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAccountsSave } from "./useAccountsSave";
import { useStagedStore } from "../../../store/staged";
import type { ActualBenchTransport } from "../../../lib/actual";
import type { ConnectionInstance } from "../../../store/connection";

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

function stageNewAccount() {
  useStagedStore.getState().stageNew("accounts", {
    id: "client-account-1",
    name: "New Checking",
    offBudget: false,
    closed: false,
    initialBalance: 12.34,
  });
}

describe("useAccountsSave", () => {
  beforeEach(() => {
    useStagedStore.getState().discardAll();
    mockGetTransport.mockReset();
    mockSyncTransportAfterChanges.mockClear();
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
});
