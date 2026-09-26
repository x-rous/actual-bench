import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConnectionStore } from "@/store/connection";
import { useSavedBudgets } from "./savedBudgets";

const getVaultStatus = jest.fn();
const listRememberedServers = jest.fn();
jest.mock("./vaultApi", () => ({
  ...jest.requireActual("./vaultApi"),
  getVaultStatus: () => getVaultStatus(),
  listRememberedServers: () => listRememberedServers(),
}));

const status = { supported: true, passphraseSet: true, unlocked: true, authMode: "password", passwordFromEnv: false };
const list = {
  supported: true,
  servers: [{ serverFingerprint: "srv", mode: "browser-api", baseUrl: "https://actual.example.com", label: "", createdAt: "", updatedAt: "" }],
  budgets: [{ serverFingerprint: "srv", budgetSyncId: "b-1", name: "Household", createdAt: "", lastOpenedAt: "" }],
};

describe("useSavedBudgets", () => {
  beforeEach(() => useConnectionStore.getState().clearAll());

  it("answers from the vault data sign-in already loaded, without asking again", () => {
    const client = new QueryClient();
    client.setQueryData(["auth-status"], status);
    client.setQueryData(["remembered-servers"], list);

    const { result } = renderHook(() => useSavedBudgets(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });

    expect(result.current.saved.map((budget) => budget.name)).toEqual(["Household"]);
    expect(result.current.locked).toBe(false);
    expect(getVaultStatus).not.toHaveBeenCalled();
    expect(listRememberedServers).not.toHaveBeenCalled();
  });
});
