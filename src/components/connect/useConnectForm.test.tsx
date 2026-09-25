import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConnectForm } from "./useConnectForm";
import {
  useConnectionStore,
  type ConnectionInstance,
  type ConnectionMode,
} from "@/store/connection";
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
const mockRevealServerSecret = jest.fn();
const mockRememberServer = jest.fn();
const mockRememberBudget = jest.fn();
const mockRememberBudgetEncryption = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock("../../features/connect/vaultApi", () => ({
  revealServerSecret: (fp: string, budgetSyncId?: string) => mockRevealServerSecret(fp, budgetSyncId),
  rememberServer: (input: unknown) => mockRememberServer(input),
  rememberBudget: (input: unknown) => mockRememberBudget(input),
  rememberBudgetEncryption: (input: unknown) => mockRememberBudgetEncryption(input),
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

/**
 * The hook must never navigate. Redirecting to /overview belongs to ConnectForm's
 * effect: an imperative push from an async connect handler outlives the component
 * and lands wherever the user has since navigated, which bounced Direct-mode users
 * back to /overview seconds after they left it.
 */
function expectNoNavigation() {
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
}

/**
 * Waits for the connection the test selected — not merely "some" connection — to
 * become active. Identity matters here: the redirect ConnectForm performs is
 * driven off the active instance, so activating the wrong budget or mode would
 * still redirect and still look green under a truthiness check.
 */
async function expectActiveInstance(expected: { budgetSyncId: string; mode: ConnectionMode }) {
  await waitFor(
    () => {
      const { instances, activeInstanceId } = useConnectionStore.getState();
      expect(instances.find((i) => i.id === activeInstanceId)).toMatchObject(expected);
    },
    { timeout: 2_000 }
  );
}

describe("useConnectForm connection activation", () => {
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
    // Default: nothing remembered for this budget (vault "locked"/empty).
    mockRevealServerSecret.mockReset().mockResolvedValue({
      mode: "http-api",
      baseUrl: "https://api.example.com",
      label: "",
      secret: { apiKey: null, serverPassword: null, encryptionPassword: null },
    });
    mockRememberServer.mockReset().mockResolvedValue({ server: {} });
    mockRememberBudget.mockReset().mockResolvedValue({ ok: true });
    mockRememberBudgetEncryption.mockReset().mockResolvedValue({ ok: true });

    resetStores();
    sessionStorage.clear();
  });

  afterEach(() => {
    act(() => {
      resetStores();
    });
  });

  it("defaults to Direct mode", () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), { wrapper: makeWrapper(client) });

    expect(result.current.connectionMode).toBe("browser-api");
  });

  it("activates a successful Direct budget connection without navigating", async () => {
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

    await expectActiveInstance({ budgetSyncId: "budget-1", mode: "browser-api" });
    expectNoNavigation();
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
      result.current.handleModeChange("http-api");
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

    // Used for the server call, never put in the field.
    expect(result.current.serverPassword).toBe("");
    await waitFor(() => expect(result.current.budgets).toHaveLength(1));
    expect(mockLoadBrowserApiBudgetList).toHaveBeenCalledWith({
      serverUrl: "https://actual.example.com",
      serverPassword: "password",
    });
    expect(result.current.heldCredential).toMatchObject({ source: "session" });
    expect(result.current.serverPassword).toBe("");
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

    await expectActiveInstance({ budgetSyncId: "local-budget-1", mode: "browser-api" });
    expectNoNavigation();
    expect(mockEnsureTransportReady).toHaveBeenCalledWith(
      expect.objectContaining({ budgetSyncId: "local-budget-1" })
    );
  });

  it("pre-fills a budget's remembered encryption password when budgets load", async () => {
    mockListBudgets.mockResolvedValue([
      { groupId: "budget-1", cloudFileId: "budget-1", name: "Budget One" },
    ]);
    mockRevealServerSecret.mockResolvedValue({
      mode: "http-api",
      baseUrl: "https://api.example.com",
      label: "",
      secret: { apiKey: null, serverPassword: null, encryptionPassword: "enc-secret" },
    });

    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), { wrapper: makeWrapper(client) });

    act(() => {
      result.current.handleModeChange("http-api");
      result.current.setBaseUrl("https://api.example.com");
      result.current.setApiKey("api-key");
    });
    act(() => {
      result.current.handleValidate();
    });

    await waitFor(() => expect(result.current.budgets).toHaveLength(1));
    // Held, not put in the field: the form says a saved one will be used.
    await waitFor(() => expect(result.current.encryptionSaved).toBe(true));
    expect(result.current.encryptionPassword).toBe("");
    expect(mockRevealServerSecret).toHaveBeenCalledWith(expect.any(String), "budget-1");

    // And connecting uses it.
    mockTestConnection.mockResolvedValue(undefined);
    act(() => {
      result.current.handleConnect();
    });
    await expectActiveInstance({ budgetSyncId: "budget-1", mode: "http-api" });
    expect(useConnectionStore.getState().instances[0]).toMatchObject({ encryptionPassword: "enc-secret" });
  });

  it("takes a typed password out of the field once the budgets load, and keeps it out after Back", async () => {
    mockLoadBrowserApiBudgetList.mockResolvedValue({ budgets: [{ groupId: "budget-1", name: "One" }], serverVersion: null });

    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), { wrapper: makeWrapper(client) });

    act(() => {
      result.current.setBaseUrl("https://actual.example.com");
      result.current.setServerPassword("typed-secret");
    });
    act(() => {
      result.current.handleValidate();
    });
    await waitFor(() => expect(result.current.budgets).toHaveLength(1));

    expect(result.current.serverPassword).toBe("");
    expect(result.current.heldCredential).toMatchObject({ source: "entered", mode: "browser-api" });

    // Back to step 1: the password is still held, still not in the field, and
    // loading the budgets again needs nothing typed.
    act(() => {
      result.current.resetStep2();
    });
    expect(result.current.serverPassword).toBe("");
    act(() => {
      result.current.handleValidate();
    });
    await waitFor(() => expect(result.current.budgets).toHaveLength(1));
    expect(mockLoadBrowserApiBudgetList).toHaveBeenLastCalledWith({
      serverUrl: "https://actual.example.com",
      serverPassword: "typed-secret",
    });

    // "Use a different password" forgets it.
    act(() => {
      result.current.chooseDifferentCredential();
    });
    expect(result.current.heldCredential).toBeNull();
  });

  it("does not keep, or show, a password the server refused", async () => {
    mockLoadBrowserApiBudgetList.mockRejectedValue(new Error("Authentication failed"));

    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), { wrapper: makeWrapper(client) });

    act(() => {
      result.current.setBaseUrl("https://actual.example.com");
      result.current.setServerPassword("wrong");
    });
    act(() => {
      result.current.handleValidate();
    });
    await waitFor(() => expect(result.current.validateStatus.kind).toBe("error"));

    expect(result.current.serverPassword).toBe("");
    expect(result.current.heldCredential).toBeNull();
  });

  it("opens another budget on a saved server without putting its password in the form", async () => {
    mockRevealServerSecret.mockResolvedValue({
      mode: "browser-api",
      baseUrl: "https://actual.example.com",
      label: "",
      secret: { apiKey: null, serverPassword: "vault-secret", encryptionPassword: null },
    });
    mockLoadBrowserApiBudgetList.mockResolvedValue({ budgets: [{ groupId: "budget-1", name: "One" }], serverVersion: null });

    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), { wrapper: makeWrapper(client) });

    await act(async () => {
      await result.current.startFromRememberedServer({
        serverFingerprint: "fp",
        mode: "browser-api",
        baseUrl: "https://actual.example.com",
        label: "",
        createdAt: "",
        updatedAt: "",
      });
    });

    expect(mockLoadBrowserApiBudgetList).toHaveBeenCalledWith({
      serverUrl: "https://actual.example.com",
      serverPassword: "vault-secret",
    });
    expect(result.current.heldCredential).toMatchObject({ source: "saved" });
    act(() => {
      result.current.resetStep2();
    });
    expect(result.current.serverPassword).toBe("");
    expect(result.current.apiKey).toBe("");
  });

  it("uses a vault-saved server's password from its chip once unlocked, and never while locked", async () => {
    const remembered = {
      serverFingerprint: "fp",
      mode: "browser-api" as const,
      baseUrl: "https://actual.example.com",
      label: "Home",
      createdAt: "",
      updatedAt: "",
    };
    mockRevealServerSecret.mockResolvedValue({
      mode: "browser-api",
      baseUrl: "https://actual.example.com",
      label: "",
      secret: { apiKey: null, serverPassword: "vault-secret", encryptionPassword: null },
    });
    mockLoadBrowserApiBudgetList.mockResolvedValue({ budgets: [{ groupId: "budget-1", name: "One" }], serverVersion: null });

    const client = new QueryClient();
    const locked = renderHook(() => useConnectForm({ rememberedServers: [remembered], vaultLocked: true }), {
      wrapper: makeWrapper(client),
    });
    // The vault's server is offered as a chip, marked as saved...
    const [chip] = locked.result.current.savedServersForMode;
    expect(chip).toMatchObject({ baseUrl: "https://actual.example.com", remembered });
    // ...but a saved connection is not used while the vault is locked.
    act(() => {
      locked.result.current.handleSelectServer(chip);
    });
    expect(mockRevealServerSecret).not.toHaveBeenCalled();
    expect(locked.result.current.baseUrl).toBe("");

    const unlocked = renderHook(() => useConnectForm({ rememberedServers: [remembered], vaultLocked: false }), {
      wrapper: makeWrapper(client),
    });
    act(() => {
      unlocked.result.current.handleSelectServer(unlocked.result.current.savedServersForMode[0]);
    });
    await waitFor(() => expect(unlocked.result.current.budgets).toHaveLength(1));
    expect(unlocked.result.current.heldCredential).toMatchObject({ source: "saved" });
    expect(unlocked.result.current.serverPassword).toBe("");
  });

  it("does not reuse an open connection's password from a chip while the vault is locked", () => {
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
    const { result } = renderHook(() => useConnectForm({ vaultLocked: true }), { wrapper: makeWrapper(client) });
    act(() => {
      result.current.handleSelectServer(server);
    });

    expect(mockLoadBrowserApiBudgetList).not.toHaveBeenCalled();
    expect(result.current.heldCredential).toBeNull();
  });

  it("lets go of everything it holds when the vault is locked", async () => {
    mockLoadBrowserApiBudgetList.mockResolvedValue({ budgets: [{ groupId: "budget-1", name: "One" }], serverVersion: null });

    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), { wrapper: makeWrapper(client) });
    act(() => {
      result.current.setBaseUrl("https://actual.example.com");
      result.current.setServerPassword("typed-secret");
    });
    act(() => {
      result.current.handleValidate();
    });
    await waitFor(() => expect(result.current.budgets).toHaveLength(1));

    act(() => {
      result.current.forgetOnLock();
    });

    expect(result.current.heldCredential).toBeNull();
    expect(result.current.budgets).toBeNull();
    expect(result.current.baseUrl).toBe("");
    // Nothing left to load the budgets with: the password must be typed again.
    act(() => {
      result.current.setBaseUrl("https://actual.example.com");
    });
    act(() => {
      result.current.handleValidate();
    });
    expect(result.current.validateStatus).toMatchObject({ kind: "error", message: "Actual Server password is required." });
  });

  it("opens a remembered budget in one click", async () => {
    mockRevealServerSecret.mockResolvedValue({
      mode: "http-api",
      baseUrl: "https://api.example.com",
      label: "",
      secret: { apiKey: "the-key", serverPassword: null, encryptionPassword: "enc-x" },
    });

    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), { wrapper: makeWrapper(client) });

    act(() => {
      void result.current.openRememberedBudget(
        { serverFingerprint: "fp", mode: "http-api", baseUrl: "https://api.example.com", label: "Home", createdAt: "", updatedAt: "" },
        { serverFingerprint: "fp", budgetSyncId: "b1", name: "Main", createdAt: "", lastOpenedAt: "" }
      );
    });

    await expectActiveInstance({ budgetSyncId: "b1", mode: "http-api" });
    expectNoNavigation();
    // Revealed with the budget id so an encrypted budget's password comes along.
    expect(mockRevealServerSecret).toHaveBeenCalledWith("fp", "b1");
    // No budget picker was involved — the instance went straight in.
    expect(useConnectionStore.getState().instances).toHaveLength(1);
    expect(useConnectionStore.getState().instances[0]).toMatchObject({
      mode: "http-api",
      budgetSyncId: "b1",
      apiKey: "the-key",
      encryptionPassword: "enc-x",
    });
  });

  it("adds nothing when a remembered budget cannot be reached", async () => {
    mockRevealServerSecret.mockResolvedValue({
      mode: "http-api",
      baseUrl: "https://api.example.com",
      label: "",
      secret: { apiKey: "the-key", serverPassword: null, encryptionPassword: null },
    });
    mockTestConnection.mockRejectedValue(Object.assign(new Error("down"), { status: 502 }));

    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), { wrapper: makeWrapper(client) });

    // Checked before it joins the session: no dead connection is left behind,
    // and none becomes active (which would leave the Connect page for it).
    await expect(
      result.current.openRememberedBudget(
        { serverFingerprint: "fp", mode: "http-api", baseUrl: "https://api.example.com", label: "Home", createdAt: "", updatedAt: "" },
        { serverFingerprint: "fp", budgetSyncId: "b1", name: "Main", createdAt: "", lastOpenedAt: "" }
      )
    ).rejects.toThrow("down");
    expect(useConnectionStore.getState().instances).toHaveLength(0);
    expect(useConnectionStore.getState().activeInstanceId).toBeNull();
  });

  it("never remembers an API key the server refused", async () => {
    useConnectionStore.getState().addInstance({
      id: "existing",
      mode: "http-api",
      label: "Budget One",
      baseUrl: "https://api.example.com",
      budgetSyncId: "budget-1",
      apiKey: "old-key",
    });
    useConnectionStore.getState().setActiveInstance(null);
    mockListBudgets.mockResolvedValue([{ groupId: "budget-1", cloudFileId: "budget-1", name: "Budget One" }]);
    mockTestConnection.mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }));

    const client = new QueryClient();
    const { result } = renderHook(() => useConnectForm(), { wrapper: makeWrapper(client) });

    act(() => {
      result.current.handleModeChange("http-api");
      result.current.setBaseUrl("https://api.example.com");
      result.current.setApiKey("rotated-key");
      result.current.setRememberOnServer(true);
    });
    act(() => {
      result.current.handleValidate();
    });
    await waitFor(() => expect(result.current.budgets).toHaveLength(1));

    act(() => {
      result.current.handleConnect();
    });

    await waitFor(() => expect(mockTestConnection).toHaveBeenCalled());
    await waitFor(() => expect(result.current.validateStatus.kind).toBe("error"));
    expect(mockRememberServer).not.toHaveBeenCalled();
  });

  it("prompts to switch when connecting a budget already saved via a different mode", async () => {
    mockListBudgets.mockResolvedValue([{ groupId: "budget-1", cloudFileId: "budget-1", name: "Budget One" }]);
    mockGetApiVersion.mockResolvedValue("1.2.3");

    const client = new QueryClient();
    const { result } = renderHook(
      () =>
        useConnectForm({
          savedBudgets: [
            {
              budgetSyncId: "budget-1",
              mode: "browser-api",
              baseUrl: "https://actual.example.com",
              label: "Budget One (Direct)",
            },
          ],
        }),
      { wrapper: makeWrapper(client) }
    );

    act(() => {
      result.current.handleModeChange("http-api");
      result.current.setBaseUrl("https://api.example.com");
      result.current.setApiKey("api-key");
    });
    act(() => {
      result.current.handleValidate();
    });
    await waitFor(() => expect(result.current.budgets).toHaveLength(1));

    act(() => {
      result.current.handleConnect();
    });

    // Same budget id, different mode → switch dialog instead of an immediate connect.
    await waitFor(() => expect(result.current.pendingBudgetSwitch).not.toBeNull());
    expect(result.current.pendingBudgetSwitch?.title).toMatch(/switch/i);
    expect(mockPush).not.toHaveBeenCalledWith("/overview");
  });

  it("activates a successful Direct reconnect without navigating", async () => {
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

    await waitFor(() => expect(useConnectionStore.getState().activeInstanceId).toBe("direct-1"), {
      timeout: 2_000,
    });
    expectNoNavigation();
  });
});
