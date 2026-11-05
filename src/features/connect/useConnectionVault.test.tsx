import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AUTH_STATUS_QUERY_KEY } from "@/hooks/useAuthStatus";
import { REMEMBERED_SERVERS_QUERY_KEY } from "./vaultQueries";
import { useConnectionVault } from "./useConnectionVault";

const mockFetchVault = jest.fn();
const mockLockVault = jest.fn();
jest.mock("./vaultQueries", () => ({ ...jest.requireActual("./vaultQueries"), fetchVault: (...args: unknown[]) => mockFetchVault(...args) }));
jest.mock("./vaultApi", () => ({ ...jest.requireActual("./vaultApi"), lockVault: () => mockLockVault() }));

const status = (over: Record<string, unknown> = {}) => ({ supported: true, passphraseSet: true, unlocked: true, authMode: "none", passwordFromEnv: false, ...over });
const list = (names: string[]) => ({ servers: names.map((n) => ({ serverFingerprint: n })), budgets: [] });
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (c: QueryClient) => {
  function Wrapper({ children }: { children: React.ReactNode }) { return <QueryClientProvider client={c}>{children}</QueryClientProvider>; }
  return Wrapper;
};

beforeEach(() => { mockFetchVault.mockReset(); mockLockVault.mockReset(); });

describe("the connection vault state", () => {
  it("reports loading until the vault is read, then shows what it holds", async () => {
    mockFetchVault.mockResolvedValue([status(), list(["srv-a"])]);
    const { result } = renderHook(() => useConnectionVault(), { wrapper: wrap(client()) });
    expect(result.current.loading).toBe(true);
    expect(result.current.status.supported).toBe(false);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status.unlocked).toBe(true);
    expect(result.current.servers).toHaveLength(1);
  });

  it("starts from what the shared cache already holds, and reads again in the background", async () => {
    const c = client();
    c.setQueryData(AUTH_STATUS_QUERY_KEY, status());
    c.setQueryData(REMEMBERED_SERVERS_QUERY_KEY, list(["cached"]));
    mockFetchVault.mockResolvedValue([status(), list(["cached", "fresh"])]);
    const { result } = renderHook(() => useConnectionVault(), { wrapper: wrap(c) });
    expect(result.current.loading).toBe(false);
    expect(result.current.servers).toHaveLength(1);
    await waitFor(() => expect(result.current.servers).toHaveLength(2));
  });

  it("treats an unavailable vault route as unsupported, not as an error", async () => {
    mockFetchVault.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useConnectionVault(), { wrapper: wrap(client()) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status.supported).toBe(false);
    expect(result.current.servers).toEqual([]);
  });

  it("reads the vault again once an action finishes, so the screen follows it", async () => {
    mockFetchVault.mockResolvedValueOnce([status({ unlocked: true }), list([])]).mockResolvedValueOnce([status({ unlocked: false }), list([])]);
    mockLockVault.mockResolvedValue(undefined);
    const { result } = renderHook(() => useConnectionVault(), { wrapper: wrap(client()) });
    await waitFor(() => expect(result.current.status.unlocked).toBe(true));
    await act(async () => { await result.current.lock(); });
    expect(mockLockVault).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.status.unlocked).toBe(false));
    expect(mockFetchVault).toHaveBeenCalledTimes(2);
  });
});
