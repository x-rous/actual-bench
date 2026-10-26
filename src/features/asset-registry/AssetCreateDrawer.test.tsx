import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetCreateDrawer } from "./AssetCreateDrawer";
import { getTransport } from "@/lib/actual";
import { useConnectionStore, type ConnectionInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";
import { registryRequest } from "./api";
import { recordStartingValue } from "./startingValue";

const saveAccounts = jest.fn();
const maps = { accounts: new Map(), groups: new Map([["group", "vehicle"]]) };
const mine = { id: "acc-car", name: "My car account", offBudget: true, closed: false, groupId: "group" };
const checking = { id: "acc-checking", name: "Everyday checking", offBudget: false, closed: false, groupId: "group" };
const created = { id: "permanent", name: "Family car", offBudget: true, closed: false, groupId: "group" };
jest.mock("@/lib/actual", () => ({ getTransport: jest.fn() }));
jest.mock("./api", () => ({ registryRequest: jest.fn() }));
jest.mock("./startingValue", () => ({ recordStartingValue: jest.fn() }));
jest.mock("@/features/accounts/hooks/useAccounts", () => ({ useAccounts: () => ({ refetch: jest.fn(async () => {}) }) }));
jest.mock("@/features/accounts/hooks/useAccountGroups", () => ({ useAccountGroups: () => ({ supported: true, data: [{ id: "group", name: "Vehicles" }] }) }));
jest.mock("@/features/accounts/hooks/useAccountClasses", () => ({ useAccountClasses: () => ({ available: true, maps }) }));
jest.mock("@/features/accounts/hooks/useAccountsSave", () => ({ useAccountsSave: () => ({ save: saveAccounts, isSaving: false }) }));
const connection = { id: "test-connection", mode: "http-api", budgetSyncId: "budget" } as ConnectionInstance;

const originalFetch = global.fetch;
afterAll(() => { global.fetch = originalFetch; });
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ accountClasses: [{ scope: "group", accountId: "group", accountClass: "vehicle" }] }) } as Response);
  useStagedStore.setState({ accounts: {}, accountGroups: {} });
  jest.mocked(registryRequest).mockResolvedValue({ assets: [], metadata: [] });
  jest.mocked(recordStartingValue).mockResolvedValue({ assets: [], metadata: [] });
  jest.mocked(getTransport).mockReturnValue({ getAccounts: async () => [mine, created], getAccountBalances: async () => new Map([["acc-car", 725]]) } as never);
  saveAccounts.mockImplementation(async ({ accountIds }: { accountIds: string[] }) => { const accounts = { ...useStagedStore.getState().accounts }; delete accounts[accountIds[0]]; useStagedStore.setState({ accounts }); return { idMap: { [accountIds[0]]: created.id }, failed: [] }; });
});
function mount() {
  const onSaved = jest.fn(); const onOpenAsset = jest.fn();
  useConnectionStore.setState({ instances: [connection], activeInstanceId: connection.id });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssetCreateDrawer connection={connection} accounts={[mine, checking]} registry={{ assets: [], metadata: [] }} today="2026-10-25" onSaved={onSaved} onOpenAsset={onOpenAsset} onClose={jest.fn()} /></QueryClientProvider>);
  return { onSaved, onOpenAsset };
}
const create = () => fireEvent.click(screen.getByRole("button", { name: "Create asset" }));

it("is one form with no purchase step, and needs a name first", async () => {
  mount();
  expect(screen.queryByRole("list", { name: "Steps" })).not.toBeInTheDocument();
  expect(screen.queryByText(/How did you get it/)).not.toBeInTheDocument();
  create();
  expect(await screen.findByText("Enter a name for this asset.")).toBeInTheDocument();
  expect(registryRequest).not.toHaveBeenCalled();
});
it("creates the asset in an account it offers, with no opening value, and opens it", async () => {
  const { onSaved, onOpenAsset } = mount();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Family car" } });
  fireEvent.click(screen.getByRole("button", { name: "Use an existing account" }));
  fireEvent.click(screen.getByLabelText("Account"));
  expect(screen.queryByText("Everyday checking")).not.toBeInTheDocument(); // on-budget: not offered
  fireEvent.click(screen.getByText("My car account"));
  expect(await screen.findByText("Book value")).toBeInTheDocument(); expect(screen.getAllByText("725.00").length).toBe(2); // shown as the book value and in the opening-value hint
  create();
  await waitFor(() => expect(onOpenAsset).toHaveBeenCalled());
  expect(registryRequest).toHaveBeenCalledWith("budget", "POST", expect.objectContaining({ asset: expect.objectContaining({ name: "Family car", actualAccountId: "acc-car" }) }));
  expect(onSaved).toHaveBeenCalled(); expect(recordStartingValue).not.toHaveBeenCalled();
});
it("creates a new account derived from the asset in one click, then records the optional starting value", async () => {
  const { onOpenAsset } = mount();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Family car" } });
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "25000" } });
  create();
  await waitFor(() => expect(onOpenAsset).toHaveBeenCalled());
  expect(saveAccounts).toHaveBeenCalledTimes(1);
  expect(registryRequest).toHaveBeenCalledWith("budget", "POST", expect.objectContaining({ asset: expect.objectContaining({ actualAccountId: "permanent" }) }));
  expect(recordStartingValue).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 2500000, assetId: expect.any(String), date: "2026-10-25" }));
});
it("keeps the asset and says so when the starting value could not be recorded", async () => {
  jest.mocked(recordStartingValue).mockRejectedValue(new Error("Actual did not answer"));
  const { onOpenAsset } = mount();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Family car" } });
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "100" } });
  create();
  expect(await screen.findByText(/asset was created, but its opening value was not recorded: Actual did not answer/)).toBeInTheDocument();
  expect(onOpenAsset).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open asset" }));
  expect(onOpenAsset).toHaveBeenCalled();
});
it("shares an account with a hashtag typed after a fixed #asset_ prefix, suggested from the name", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Family car" } });
  fireEvent.click(screen.getByRole("switch", { name: "Shared with other assets" }));
  expect(screen.getByRole("textbox", { name: /Asset hashtag/ })).toHaveValue("family_car");
  fireEvent.change(screen.getByRole("textbox", { name: /Asset hashtag/ }), { target: { value: "My Car!" } });
  expect(screen.getByRole("textbox", { name: /Asset hashtag/ })).toHaveValue("my_car_");
});
