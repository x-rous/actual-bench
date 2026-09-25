/**
 * @jest-environment jsdom
 */
import { useConnectionStore, type ConnectionInstance } from "@/store/connection";
import * as reconnect from "./reconnectFromVault";
import * as vaultApi from "./vaultApi";
import { connectFailureMessage, connectSavedBudget, isConnected, joinSavedBudgets, type SavedBudget } from "./savedBudgets";

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
  mockedVault.rememberBudget.mockResolvedValue({ ok: true });
});

describe("connecting a saved budget (PR-071b)", () => {
  it("from the toolbar: checks it is reachable, then adds it and makes it active", async () => {
    const instance = await connectSavedBudget(saved, { activate: true });

    expect(mockedVault.revealServerSecret).toHaveBeenCalledWith("srv-1", "budget-2");
    expect(mockedReady).toHaveBeenCalledWith(instance);
    expect(instance).toMatchObject({ budgetSyncId: "budget-2", serverPassword: "pw", encryptionPassword: "e2ee", label: "Joint" });
    expect(useConnectionStore.getState().activeInstanceId).toBe(instance.id);
    // Moves it to the top of the Saved list, most recently opened first.
    expect(mockedVault.rememberBudget).toHaveBeenCalledWith({ serverFingerprint: "srv-1", budgetSyncId: "budget-2", name: "Joint" });
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

  it("prepares the switch only after the check, before the budget joins the session", async () => {
    const order: string[] = [];
    mockedReady.mockImplementation(async () => {
      order.push("checked");
    });

    await connectSavedBudget(saved, {
      activate: true,
      prepare: (instance) => {
        order.push("prepared");
        // Nothing has joined the session yet: the current budget is untouched.
        expect(useConnectionStore.getState().activeInstanceId).toBe("c-1");
        return { ...instance, serverVersion: "25.1.0" };
      },
    });

    expect(order).toEqual(["checked", "prepared"]);
    // What `prepare` returned is what joined the session.
    expect(useConnectionStore.getState().instances.at(-1)).toMatchObject({ budgetSyncId: "budget-2", serverVersion: "25.1.0" });
  });

  it("never prepares a switch that will not happen", async () => {
    mockedReady.mockRejectedValue(new Error("Authentication failed"));
    const prepare = jest.fn((instance: ConnectionInstance) => instance);

    await expect(connectSavedBudget(saved, { activate: true, prepare })).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("says why it could not connect in one sentence", () => {
    expect(connectFailureMessage("Joint", new Error("Vault is locked. Unlock to reconnect."))).toBe(
      "Could not connect to Joint: Vault is locked. Unlock to reconnect."
    );
    expect(connectFailureMessage("Joint", "?")).toBe("Could not connect to Joint: the server did not answer.");
  });

  it("joins saved budgets to their servers, leaving out a budget whose server is gone", () => {
    const server = { serverFingerprint: "srv-1", mode: "http-api" as const, baseUrl: "https://api.example.com", label: "", createdAt: "", updatedAt: "" };
    const budget = (budgetSyncId: string, serverFingerprint = "srv-1") => ({
      serverFingerprint,
      budgetSyncId,
      name: "",
      createdAt: "",
      lastOpenedAt: "",
    });

    expect(joinSavedBudgets([server], [budget("b-1"), budget("b-2", "gone")])).toEqual([
      {
        serverFingerprint: "srv-1",
        budgetSyncId: "b-1",
        name: "b-1",
        mode: "http-api",
        baseUrl: "https://api.example.com",
        serverLabel: "https://api.example.com",
      },
    ]);
  });

  it("counts a budget as connected when it is connected in either mode", () => {
    expect(isConnected({ ...saved, budgetSyncId: "budget-1", mode: "http-api" }, [current])).toBe(true);
    expect(isConnected(saved, [current])).toBe(false);
  });
});
