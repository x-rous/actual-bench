/**
 * @jest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useConnectionStore, type ConnectionInstance } from "@/store/connection";
import * as reconnect from "./reconnectFromVault";
import * as vaultApi from "./vaultApi";
import { useSavedBudgetSwitcher } from "./useSavedBudgetSwitcher";

jest.mock("./vaultApi", () => ({
  ...jest.requireActual("./vaultApi"),
  getVaultStatus: jest.fn(),
  listRememberedServers: jest.fn(),
  revealServerSecret: jest.fn(),
  unlockVault: jest.fn(),
  rememberBudget: jest.fn(),
}));
jest.mock("./reconnectFromVault", () => ({
  ...jest.requireActual("./reconnectFromVault"),
  ensureConnectionReady: jest.fn(),
}));
jest.mock("sonner", () => ({
  toast: { loading: jest.fn(() => "t"), success: jest.fn(), error: jest.fn(), dismiss: jest.fn() },
}));

const mockedVault = vaultApi as jest.Mocked<typeof vaultApi>;
const mockedReady = reconnect.ensureConnectionReady as jest.Mock;

const current = {
  id: "c-1",
  label: "Household",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  budgetSyncId: "budget-1",
  serverPassword: "pw",
} as ConnectionInstance;

let unlocked = false;
const prepare = jest.fn();

function Harness() {
  const switcher = useSavedBudgetSwitcher({ prepare });
  return (
    <>
      {switcher.saved.map((budget) => (
        <button key={budget.budgetSyncId} type="button" onClick={() => void switcher.open(budget)}>
          Open {budget.name}
        </button>
      ))}
      {switcher.dialog}
    </>
  );
}

function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  );
}

async function unlockWith(passphrase: string) {
  fireEvent.change(await screen.findByLabelText("Vault passphrase"), { target: { value: passphrase } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
}

beforeEach(() => {
  jest.clearAllMocks();
  unlocked = false;
  useConnectionStore.setState({ instances: [current], activeInstanceId: current.id });
  mockedVault.getVaultStatus.mockImplementation(async () => ({ supported: true, passphraseSet: true, unlocked }));
  mockedVault.listRememberedServers.mockResolvedValue({
    supported: true,
    servers: [
      { serverFingerprint: "srv-1", mode: "browser-api", baseUrl: "https://actual.example.com", label: "", createdAt: "", updatedAt: "" },
    ],
    budgets: [{ serverFingerprint: "srv-1", budgetSyncId: "budget-2", name: "Joint", createdAt: "", lastOpenedAt: "" }],
  });
  mockedVault.unlockVault.mockImplementation(async () => {
    unlocked = true;
    return { ok: true, unlocked: true };
  });
  mockedVault.revealServerSecret.mockResolvedValue({
    mode: "browser-api",
    baseUrl: "https://actual.example.com",
    label: "",
    secret: { apiKey: null, serverPassword: "pw", encryptionPassword: null },
  });
  mockedVault.rememberBudget.mockResolvedValue({ ok: true });
  mockedReady.mockResolvedValue(undefined);
});

const activeBudget = () =>
  useConnectionStore.getState().instances.find((entry) => entry.id === useConnectionStore.getState().activeInstanceId)
    ?.budgetSyncId;

describe("opening a saved budget from the toolbar", () => {
  it("asks for the passphrase once when locked, then connects and switches", async () => {
    renderHarness();
    fireEvent.click(await screen.findByRole("button", { name: "Open Joint" }));

    await unlockWith("correct horse");

    await waitFor(() => expect(activeBudget()).toBe("budget-2"));
    // Straight on after the unlock: the dialog closed and was not asked again.
    expect(mockedVault.unlockVault).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Vault passphrase")).not.toBeInTheDocument();
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("asks again when the unlock ran out since the list was read, then carries on", async () => {
    unlocked = true;
    mockedVault.revealServerSecret.mockRejectedValueOnce(
      Object.assign(new Error("Vault is locked. Unlock to reconnect."), { code: "VAULT_LOCKED" })
    );

    renderHarness();
    fireEvent.click(await screen.findByRole("button", { name: "Open Joint" }));

    await unlockWith("correct horse");

    await waitFor(() => expect(activeBudget()).toBe("budget-2"));
    expect(mockedVault.revealServerSecret).toHaveBeenCalledTimes(2);
  });

  it("leaves the current budget and its edits alone when the budget cannot be reached", async () => {
    unlocked = true;
    mockedReady.mockRejectedValue(new Error("Authentication failed"));

    renderHarness();
    fireEvent.click(await screen.findByRole("button", { name: "Open Joint" }));

    await waitFor(() => expect(mockedReady).toHaveBeenCalled());
    expect(activeBudget()).toBe("budget-1");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("connects one budget at a time", async () => {
    unlocked = true;
    let finish: () => void = () => {};
    mockedReady.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));

    renderHarness();
    const open = await screen.findByRole("button", { name: "Open Joint" });
    fireEvent.click(open);
    fireEvent.click(open);
    await waitFor(() => expect(mockedReady).toHaveBeenCalled());
    finish();

    await waitFor(() => expect(activeBudget()).toBe("budget-2"));
    expect(mockedVault.revealServerSecret).toHaveBeenCalledTimes(1);
  });
});
