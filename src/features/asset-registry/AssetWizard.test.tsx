import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetWizard } from "./AssetWizard";
import { getTransport } from "@/lib/actual";
import { useConnectionStore, type ConnectionInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";
import type { AccountFormValues } from "@/features/accounts/schemas/account.schema";
import type { PickedTransaction } from "@/components/transactions/transactionPickerQuery";
import { registryRequest } from "./api";
import { startPurchase } from "./wizardRun";

const saveAccounts = jest.fn();
const maps = { accounts: new Map(), groups: new Map([["group", "vehicle"]]) };
const mine = { id: "acc-car", name: "My car account", offBudget: true, closed: false, groupId: "group" };
const checking = { id: "acc-checking", name: "Everyday checking", offBudget: false, closed: false, groupId: "group" };
const created = { id: "permanent", name: "New vehicle account", offBudget: true, closed: false, groupId: "group" };
const mockExpense: PickedTransaction = { id: "dealer", accountId: "acc-checking", accountName: "Everyday checking", date: "2026-02-01", amountMinor: -8000000, payeeId: null, payeeName: "Dealer", categoryId: "c", categoryName: "Cars", notes: null, transferId: null };
jest.mock("@/lib/actual", () => ({ getTransport: jest.fn() }));
jest.mock("./api", () => ({ registryRequest: jest.fn() }));
jest.mock("./wizardRun", () => ({ startPurchase: jest.fn() }));
jest.mock("@/features/accounts/hooks/useAccounts", () => ({ useAccounts: () => ({ refetch: jest.fn(async () => {}) }) }));
jest.mock("@/features/accounts/hooks/useAccountGroups", () => ({ useAccountGroups: () => ({ supported: true, data: [{ id: "group", name: "Vehicles" }] }) }));
jest.mock("@/features/accounts/hooks/useAccountClasses", () => ({ useAccountClasses: () => ({ available: true, maps }) }));
jest.mock("@/features/accounts/hooks/useAccountsSave", () => ({ useAccountsSave: () => ({ save: saveAccounts, isSaving: false }) }));
jest.mock("@/features/accounts/components/AccountFormDrawer", () => ({ AccountFormDrawer: ({ open, onSubmit, onOpenChange }: { open: boolean; onSubmit: (v: AccountFormValues) => void; onOpenChange: (v: boolean) => void }) => open ? <button onClick={() => { onSubmit({ name: "New vehicle account", offBudget: true, accountClass: "vehicle", groupId: "group" }); onOpenChange(false); }}>Stage test account</button> : null }));
jest.mock("@/components/transactions/TransactionPickerPanel", () => ({ TransactionPickerPanel: ({ onSelectionChange }: { onSelectionChange: (rows: unknown[]) => void }) => <button onClick={() => onSelectionChange([mockExpense])}>Pick the dealer expense</button> }));
const connection = { id: "test-connection", mode: "http-api", budgetSyncId: "budget" } as ConnectionInstance;

const originalFetch = global.fetch;
afterAll(() => { global.fetch = originalFetch; });
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ accountClasses: [{ scope: "group", accountId: "group", accountClass: "vehicle" }] }) } as Response); useStagedStore.setState({ accounts: {}, accountGroups: {} });
  jest.mocked(registryRequest).mockResolvedValue({ assets: [], metadata: [] });
  jest.mocked(getTransport).mockReturnValue({ getAccounts: async () => [mine, created], getCategoryGroups: async () => ({ categories: [], groups: [] }) } as never);
  saveAccounts.mockImplementation(async ({ accountIds }: { accountIds: string[] }) => { const accounts = { ...useStagedStore.getState().accounts }; delete accounts[accountIds[0]]; useStagedStore.setState({ accounts }); return { idMap: { [accountIds[0]]: created.id }, failed: [] }; });
});
function mount(onSaved = jest.fn(), onOpenAsset = jest.fn()) {
  useConnectionStore.setState({ instances: [connection], activeInstanceId: connection.id });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssetWizard connection={connection} accounts={[mine, checking]} registry={{ assets: [], metadata: [] }} today="2026-10-25" onSaved={onSaved} onOpenAsset={onOpenAsset} onClose={jest.fn()} /></QueryClientProvider>);
  return { onSaved, onOpenAsset };
}
const next = () => fireEvent.click(screen.getByRole("button", { name: /^(Next|Skip and review)$/ }));
const chooseExisting = () => { fireEvent.click(screen.getByRole("button", { name: "Use an existing account" })); fireEvent.click(screen.getByLabelText("Account")); fireEvent.click(screen.getByText("My car account")); };

it("walks three steps, offers only accounts the asset can use, and creates the asset when the purchase is skipped", async () => {
  const { onSaved, onOpenAsset } = mount();
  expect(screen.getByRole("list", { name: "Steps" })).toHaveTextContent("The asset");
  fireEvent.click(screen.getByRole("button", { name: "Next" })); // a name is required first
  expect(await screen.findByText("Enter a name for this asset.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Family car" } });
  expect(screen.getByRole("button", { name: "Create a new account" })).toHaveAttribute("aria-pressed", "true"); // both options are visible; a new account is the default
  fireEvent.click(screen.getByRole("button", { name: "Use an existing account" }));
  fireEvent.click(screen.getByLabelText("Account"));
  expect(screen.getByText("My car account")).toBeInTheDocument();
  expect(screen.queryByText("Everyday checking")).not.toBeInTheDocument(); // on-budget: not offered
  fireEvent.click(screen.getByText("My car account"));
  expect(screen.getByText(/1 other account isn't listed/)).toBeInTheDocument();
  next();
  fireEvent.click(screen.getByRole("radio", { name: /I'll do this later/ }));
  next();
  expect(screen.getByRole("list", { name: "What will happen" })).toHaveTextContent(/Create the asset “Family car”/);
  fireEvent.click(screen.getByRole("button", { name: "Create asset" }));
  await waitFor(() => expect(onOpenAsset).toHaveBeenCalledWith(expect.any(String))); // straight to the asset, no confirmation page
  expect(screen.queryByText("Asset created")).not.toBeInTheDocument();
  expect(registryRequest).toHaveBeenCalledWith("budget", "POST", expect.objectContaining({ asset: expect.objectContaining({ name: "Family car", actualAccountId: "acc-car", assetType: "vehicle", ownership: [{ effectiveFrom: "1900-01-01", ownershipBps: 10000 }] }) }));
  expect(startPurchase).not.toHaveBeenCalled(); expect(onSaved).toHaveBeenCalled();
});
it("derives a new account from the asset with no account form, and records an expense as its purchase, all inside the dialog", async () => {
  const commit = jest.fn(async () => ({ assets: [], metadata: [] }));
  jest.mocked(startPurchase).mockResolvedValue({ commit });
  const { onOpenAsset } = mount();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Family car" } });
  expect(screen.getByText(/A new off-budget account named “Family car” is created/)).toBeInTheDocument(); // nothing else to fill in
  next(); // no account form is shown: the account is the asset's name, off budget, with the class its type needs
  expect(screen.queryByRole("button", { name: "Stage test account" })).not.toBeInTheDocument();
  expect(Object.values(useStagedStore.getState().accounts)[0]).toMatchObject({ isNew: true, entity: { name: "Family car", offBudget: true }, pendingAccountClass: "vehicle" });
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled(); // choose one of the options first
  fireEvent.click(screen.getByRole("radio", { name: /Pick a transaction I already have/ }));
  fireEvent.click(screen.getByRole("button", { name: "Pick the dealer expense" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
  expect(screen.getByText(/the expense and its category stay exactly as they are/)).toBeInTheDocument(); next();
  const review = screen.getByRole("list", { name: "What will happen" });
  expect(within(review).getByText(/Create the Actual account “Family car”/)).toBeInTheDocument();
  expect(screen.getByText(/recorded value will change by/)).toHaveTextContent("80,000.00");
  fireEvent.click(screen.getByRole("button", { name: "Create asset" }));
  await waitFor(() => expect(onOpenAsset).toHaveBeenCalled());
  expect(saveAccounts).toHaveBeenCalledWith({ accountIds: [expect.any(String)] });
  expect(startPurchase).toHaveBeenCalledWith(expect.objectContaining({ kind: "expense" }), expect.objectContaining({ budgetSyncId: "budget", shared: false }));
  expect(commit).toHaveBeenCalledTimes(1);
});
it("keeps the asset when recording the value fails and retries only what is left", async () => {
  const commit = jest.fn().mockRejectedValueOnce(new Error("Metadata unavailable")).mockResolvedValueOnce({ assets: [], metadata: [] });
  jest.mocked(startPurchase).mockResolvedValue({ commit });
  const { onOpenAsset } = mount();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Flat" } });
  chooseExisting(); next();
  fireEvent.click(screen.getByRole("radio", { name: /Enter a value/ }));
  fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: "250000" } }); next();
  fireEvent.click(screen.getByRole("button", { name: "Create asset" }));
  expect(await screen.findByText("Metadata unavailable")).toBeInTheDocument();
  expect(screen.getByText(/The asset exists/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(onOpenAsset).toHaveBeenCalledTimes(1));
  expect(registryRequest).toHaveBeenCalledTimes(1); // the asset was saved once
  expect(startPurchase).toHaveBeenCalledTimes(1); // the Actual write is never repeated; only the saving of its relationship
  expect(commit).toHaveBeenCalledTimes(2);
});
it("takes ownership as a simple percentage that defaults to 100 and is checked before moving on", async () => {
  const { onOpenAsset } = mount();
  expect(screen.getByLabelText("Your ownership")).toHaveValue(100);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Flat" } });
  fireEvent.change(screen.getByLabelText("Your ownership"), { target: { value: "150" } });
  expect(await screen.findByText("Enter a share between 0.01 and 100.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" })); // blocked until the share is valid
  expect(screen.getByRole("list", { name: "Steps" })).toHaveTextContent("The asset");
  fireEvent.change(screen.getByLabelText("Your ownership"), { target: { value: "60" } });
  chooseExisting(); next();
  fireEvent.click(screen.getByRole("radio", { name: /I'll do this later/ })); next();
  expect(screen.getByRole("list", { name: "What will happen" })).toHaveTextContent(/you own 60%/);
  fireEvent.click(screen.getByRole("button", { name: "Create asset" }));
  await waitFor(() => expect(onOpenAsset).toHaveBeenCalled());
  expect(registryRequest).toHaveBeenCalledWith("budget", "POST", expect.objectContaining({ asset: expect.objectContaining({ ownership: [{ effectiveFrom: "1900-01-01", ownershipBps: 6000 }] }) }));
});
it("groups the asset's details and its account into two titled sections", () => {
  mount();
  expect(screen.getByRole("group", { name: "About the asset" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Its account in Actual" })).toBeInTheDocument();
});
it("keeps Generates income compact with its explanation behind the (i), and shows the shared-account hashtag only when switched on", () => {
  mount();
  expect(screen.getByRole("switch", { name: "Generates income" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "More about Generates income" })).toBeInTheDocument(); // the explanation is one hover away
  expect(screen.queryByLabelText("Asset hashtag")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch", { name: /holds more than one asset/ }));
  fireEvent.change(screen.getByLabelText("Asset hashtag"), { target: { value: "#asset_family_car" } });
  expect(screen.getByLabelText("Asset hashtag")).toHaveValue("#asset_family_car");
});
it("records how an existing asset was obtained: starts at that step, offers no skip, and creates nothing else", async () => {
  const commit = jest.fn(async () => ({ assets: [], metadata: [] }));
  jest.mocked(startPurchase).mockResolvedValue({ commit });
  const onOpenAsset = jest.fn(); const onSaved = jest.fn();
  const asset = { id: "flat", budgetSyncId: "budget", actualAccountId: "acc-car", name: "Flat", assetType: "vehicle", assetTag: null, description: null, status: "active", incomeGenerating: false, revision: 1, ownership: [{ effectiveFrom: "1900-01-01", ownershipBps: 10000 }], createdAt: "", updatedAt: "", archivedAt: null };
  useConnectionStore.setState({ instances: [connection], activeInstanceId: connection.id });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssetWizard asset={asset} connection={connection} accounts={[mine, checking]} registry={{ assets: [asset], metadata: [] }} today="2026-10-25" onSaved={onSaved} onOpenAsset={onOpenAsset} onClose={jest.fn()} /></QueryClientProvider>);
  expect(screen.getByText("Record how you got Flat")).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Steps" })).toHaveTextContent("How you got it");
  expect(screen.getByRole("list", { name: "Steps" })).not.toHaveTextContent("The asset");
  expect(screen.queryByRole("radio", { name: /I'll do this later/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /Enter a value/ }));
  fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: "250000" } }); next();
  expect(screen.getByRole("list", { name: "What will happen" })).not.toHaveTextContent(/Create the asset/);
  fireEvent.click(screen.getByRole("button", { name: "Record it" }));
  await waitFor(() => expect(onOpenAsset).toHaveBeenCalled());
  expect(registryRequest).not.toHaveBeenCalled(); // the asset is not saved again
  expect(startPurchase).toHaveBeenCalledWith(expect.objectContaining({ kind: "opening-new", amountMinor: 25000000 }), expect.objectContaining({ assetId: "flat", shared: false }));
});
