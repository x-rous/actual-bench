import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBankSync } from "./useBankSync";
import type { ConnectionInstance } from "../../../store/connection";

const mockGetTransport = jest.fn();

jest.mock("../../../lib/actual", () => ({
  getTransport: (connection: unknown) => (mockGetTransport as jest.Mock)(connection),
}));

const connection: ConnectionInstance = {
  id: "conn-1",
  label: "HTTP API",
  mode: "http-api",
  baseUrl: "https://api.example.com",
  apiKey: "key",
  budgetSyncId: "budget-1",
};

jest.mock("../../../store/connection", () => ({
  useConnectionStore: jest.fn(() => connection),
  selectActiveInstance: jest.fn(),
}));

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

function transport(overrides: Record<string, unknown> = {}) {
  return {
    mode: "http-api",
    getSyncCapabilities: () => ({ capabilities: { runBankSync: true } }),
    runBankSync: jest.fn(),
    ...overrides,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useBankSync availability", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does not offer the action while the availability check is still running", async () => {
    let resolveCheck: (value: boolean) => void = () => {};
    mockGetTransport.mockReturnValue(
      transport({ canRunBankSync: () => new Promise<boolean>((resolve) => { resolveCheck = resolve; }) })
    );

    const { result } = renderHook(() => useBankSync(), { wrapper });

    // Pending is not a yes: offering the action here would put it in front of
    // someone before Bench knows the connection can do it.
    expect(result.current.supported).toBe(false);

    resolveCheck(true);
    await waitFor(() => expect(result.current.supported).toBe(true));
  });

  it("does not offer the action when the loaded build cannot do it", async () => {
    mockGetTransport.mockReturnValue(transport({ canRunBankSync: async () => false }));

    const { result } = renderHook(() => useBankSync(), { wrapper });

    await waitFor(() => expect(result.current.supported).toBe(false));
  });

  it("does not offer the action when the availability check itself fails", async () => {
    mockGetTransport.mockReturnValue(
      transport({
        canRunBankSync: async () => {
          throw new Error("runtime unavailable");
        },
      })
    );

    const { result } = renderHook(() => useBankSync(), { wrapper });

    // An unanswered question is not a yes.
    await waitFor(() => expect(result.current.supported).toBe(false));
  });

  it("does not ask at all when the transport does not declare the capability", async () => {
    const canRunBankSync = jest.fn(async () => true);
    mockGetTransport.mockReturnValue(
      transport({
        getSyncCapabilities: () => ({ capabilities: { runBankSync: false } }),
        canRunBankSync,
      })
    );

    const { result } = renderHook(() => useBankSync(), { wrapper });

    await waitFor(() => expect(result.current.supported).toBe(false));
    expect(canRunBankSync).not.toHaveBeenCalled();
  });

  it("falls back to the method's presence for a transport with no check", async () => {
    mockGetTransport.mockReturnValue(transport({ canRunBankSync: undefined }));

    const { result } = renderHook(() => useBankSync(), { wrapper });

    await waitFor(() => expect(result.current.supported).toBe(true));
  });
});
