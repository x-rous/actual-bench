import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetEditor } from "./AssetEditor";
import { getTransport } from "@/lib/actual";
import { useConnectionStore, type ConnectionInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";
import { testAsset } from "@/lib/asset-registry/testing";
import { registryRequest } from "./api";

const maps = { accounts: new Map(), groups: new Map([["group", "vehicle"]]) };
const account = { id: "vehicles", name: "Vehicles", offBudget: true, closed: false, groupId: "group" };
jest.mock("@/lib/actual", () => ({ getTransport: jest.fn() }));
jest.mock("./api", () => ({ registryRequest: jest.fn() }));
jest.mock("@/features/accounts/hooks/useAccounts", () => ({ useAccounts: () => ({ refetch: jest.fn(async () => {}) }) }));
jest.mock("@/features/accounts/hooks/useAccountGroups", () => ({ useAccountGroups: () => ({ supported: true, data: [{ id: "group", name: "Vehicles" }] }) }));
jest.mock("@/features/accounts/hooks/useAccountClasses", () => ({ useAccountClasses: () => ({ available: true, maps }) }));
jest.mock("@/features/accounts/hooks/useAccountsSave", () => ({ useAccountsSave: () => ({ save: jest.fn(), isSaving: false }) }));
const connection = { id: "test-connection", mode: "http-api", budgetSyncId: "budget" } as ConnectionInstance;
const asset = testAsset("byd", { incomeGenerating: false, ownership: [{ effectiveFrom: "2024-01-01", ownershipBps: 10000 }, { effectiveFrom: "2026-01-01", ownershipBps: 7500 }] });
beforeEach(() => {
  jest.clearAllMocks(); useStagedStore.setState({ accounts: {}, accountGroups: {} });
  jest.mocked(registryRequest).mockResolvedValue({ assets: [], metadata: [] });
  jest.mocked(getTransport).mockReturnValue({ getAccounts: async () => [account] } as never);
});
function mount(props: Partial<React.ComponentProps<typeof AssetEditor>> = {}) {
  useConnectionStore.setState({ instances: [connection], activeInstanceId: connection.id });
  const onSaved = jest.fn(); const onClose = jest.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssetEditor connection={connection} asset={asset} registry={{ assets: [asset], metadata: [] }} accounts={[account]} onClose={onClose} onSaved={onSaved} {...props} /></QueryClientProvider>);
  return { onSaved, onClose };
}

it("puts Status first, shows the account as a summary and ownership as a table with the current share marked", () => {
  mount();
  const labels = screen.getAllByText(/^(Details|Actual account|Ownership)$/).map((e) => e.textContent);
  expect(labels).toEqual(["Details", "Actual account", "Ownership"]);
  expect(screen.getByRole("switch", { name: "Active" })).toBeChecked(); // beside Generates income
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("row")).toHaveLength(3); // header + two periods
  expect(within(table).getByText("Current")).toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: /Shared Asset Account/ })).not.toBeInTheDocument(); // sharing lives under Advanced
});
it("saves a renamed asset with a changed share and closes", async () => {
  const { onSaved, onClose } = mount();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
  fireEvent.change(screen.getByLabelText("Ownership percentage 2"), { target: { value: "60" } });
  fireEvent.click(screen.getByRole("button", { name: "Save asset" }));
  await waitFor(() => expect(registryRequest).toHaveBeenCalledWith("budget", "POST", expect.objectContaining({ asset: expect.objectContaining({ name: "Renamed", ownership: [{ effectiveFrom: "2024-01-01", ownershipBps: 10000 }, { effectiveFrom: "2026-01-01", ownershipBps: 6000 }] }) })));
  await waitFor(() => expect(onSaved).toHaveBeenCalled()); expect(onClose).toHaveBeenCalled();
});
it("warns when archiving an asset that still has a value, and rejects two shares on one date", async () => {
  mount({ recordedValueMinor: 25000000 });
  fireEvent.click(screen.getByRole("switch", { name: "Active" })); // off = archived
  expect(screen.getByRole("status")).toHaveTextContent(/still has a recorded value of 250,000.00/);
  fireEvent.click(screen.getByRole("button", { name: "Add a change of share" }));
  fireEvent.change(screen.getByLabelText("Ownership effective date 3"), { target: { value: "01/01/2026" } });
  fireEvent.blur(screen.getByLabelText("Ownership effective date 3"));
  expect(await screen.findByText(/Two rows have the same date/)).toBeInTheDocument();
});
