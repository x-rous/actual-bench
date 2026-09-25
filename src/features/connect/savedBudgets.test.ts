/**
 * @jest-environment jsdom
 */
import { useConnectionStore, type ConnectionInstance } from "@/store/connection";
import * as reconnect from "./reconnectFromVault";
import * as vaultApi from "./vaultApi";
import { connectSavedBudget, isConnected, type SavedBudget } from "./savedBudgets";

jest.mock("./vaultApi");
jest.mock("./reconnectFromVault", () => ({
  ...jest.requireActual("./reconnectFromVault"),
  ensureConnectionReady: jest.fn(),
}));

const mockedVault = vaultApi as jest.Mocked<typeof vaultApi>;
const mockedReady = reconnect.ensureConnectionReady as jest.Mock;

const saved: SavedBudget = {
  serverFingerprint: "srv-1",
  budgetSyncId: "budget-2",
  name: "Joint",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  serverLabel: "Home server",
};

const current = {
  id: "c-1",
  label: "Household",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  budgetSyncId: "budget-1",
  serverPassword: "pw",
} as ConnectionInstance;

beforeEach(() => {
  jest.clearAllMocks();
  useConnectionStore.setState({ instances: [current], activeInstanceId: current.id });
  mockedVault.revealServerSecret.mockResolvedValue({
    mode: "browser-api",
    baseUrl: "https://actual.example.com",
    label: "Home server",
    secret: { apiKey: null, serverPassword: "pw", encryptionPassword: "e2ee" },
  });
  mockedReady.mockResolvedValue(undefined);
});

describe("connecting a saved budget (PR-071b)", () => {
  it("from the toolbar: checks it is reachable, then adds it and makes it active", async () => {
    const instance = await connectSavedBudget(saved, { activate: true });

    expect(mockedVault.revealServerSecret).toHaveBeenCalledWith("srv-1", "budget-2");
    expect(mockedReady).toHaveBeenCalledWith(instance);
    expect(instance).toMatchObject({ budgetSyncId: "budget-2", serverPassword: "pw", encryptionPassword: "e2ee", label: "Joint" });
    expect(useConnectionStore.getState().activeInstanceId).toBe(instance.id);
  });

  it("from a picker: joins the session without changing the active budget", async () => {
    const instance = await connectSavedBudget(saved, { activate: false });

    expect(mockedReady).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().instances.map((entry) => entry.id)).toContain(instance.id);
    expect(useConnectionStore.getState().activeInstanceId).toBe("c-1");
  });

  it("leaves everything as it was when the budget cannot be reached", async () => {
    mockedReady.mockRejectedValue(new Error("Authentication failed"));

    await expect(connectSavedBudget(saved, { activate: true })).rejects.toThrow("Authentication failed");
    expect(useConnectionStore.getState().instances).toEqual([current]);
    expect(useConnectionStore.getState().activeInstanceId).toBe("c-1");
  });

  it("counts a budget as connected when it is connected in either mode", () => {
    expect(isConnected({ ...saved, budgetSyncId: "budget-1", mode: "http-api" }, [current])).toBe(true);
    expect(isConnected(saved, [current])).toBe(false);
  });
});
