import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssetWorkspace } from "./AssetWorkspace";
import { registryRequest } from "./api";
import { getTransport } from "@/lib/actual";
import { useConnectionStore, type ConnectionInstance } from "@/store/connection";
import { testAsset, testRow } from "@/lib/asset-registry/testing";
import type { ActualBenchTransport } from "@/lib/actual/transport";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/lib/actual", () => ({ getTransport: jest.fn() }));
jest.mock("./api", () => ({ registryRequest: jest.fn() }));
jest.mock("./AssetEditor", () => ({ AssetEditor: () => <div role="dialog" aria-label="Asset Settings" /> }));
jest.mock("@/features/credit-cards/components/HistoryChart", () => ({ HistoryChart: ({ title }: { title: string }) => <figure><figcaption>{title}</figcaption></figure> }));
jest.mock("@/features/accounts/hooks/useAccountClasses", () => ({ useAccountClasses: () => ({ available: true, maps: { accounts: new Map([["vehicles", "vehicle"]]), groups: new Map() } }) }));
jest.mock("@/features/credit-cards/lib/cycles", () => ({ ...jest.requireActual("@/features/credit-cards/lib/cycles"), bankToday: () => "2026-10-24" }));
const assets = [testAsset("byd", { name: "BYD Seal" }), testAsset("toyota", { name: "Toyota Corolla" })];
function mount(assetId?: string) {
  useConnectionStore.setState({ instances: [{ id: "test", mode: "http-api", budgetSyncId: "budget" } as ConnectionInstance], activeInstanceId: "test" });
  jest.mocked(registryRequest).mockResolvedValue({ assets, metadata: [] });
  jest.mocked(getTransport).mockReturnValue({
    mode: "http-api", getAccounts: async () => [{ id: "vehicles", name: "Vehicles", offBudget: true, closed: false }],
    listTransactionsForSync: async () => [testRow("byd-row", 11000000, { notes: "Opening #asset_byd" }), testRow("toyota-row", 7500000, { notes: "#asset_toyota" }), testRow("unassigned", 500000)],
    getAccountBalances: async () => new Map([["vehicles", 190000]]), canVerifyTransferLinks: async () => true,
    getSyncCapabilities: () => ({ capabilities: { listTransactions: true, readSplitLines: true } }),
  } as unknown as ActualBenchTransport);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  render(<QueryClientProvider client={client}><AssetWorkspace assetId={assetId} /></QueryClientProvider>);
}
it("shows current summary cards and a compact registry; searching changes the table rather than the portfolio summary", async () => {
  mount();
  await within(screen.getByLabelText("Asset registry summary")).findByText("185,000.00");
  const summary = screen.getByLabelText("Asset registry summary");
  expect(screen.getByLabelText("Asset status")).toBeInTheDocument();
  expect(screen.getByLabelText("Filter asset type")).toBeInTheDocument();
  expect(screen.queryByLabelText("Sort assets")).not.toBeInTheDocument(); // columns sort instead
  expect(screen.getByText(/5,000.00 Unassigned/)).toBeInTheDocument();
  expect(screen.queryByLabelText("As of")).not.toBeInTheDocument();
  expect(screen.queryByText("Account-backed values and Asset Ledger entries")).not.toBeInTheDocument();
  expect(screen.queryByRole("table", { name: "Linked asset accounts" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Linked accounts" }));
  const accountsDialog = await screen.findByRole("dialog", { name: "Linked accounts" });
  expect(within(accountsDialog).getByRole("table", { name: "Linked asset accounts" })).toBeInTheDocument();
  fireEvent.click(within(accountsDialog).getByRole("button", { name: "Close" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search assets" }), { target: { value: "BYD" } });
  expect(screen.getByRole("link", { name: "BYD Seal" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Toyota Corolla" })).not.toBeInTheDocument();
  expect(within(summary).getByText("185,000.00")).toBeInTheDocument();
});
it("shows financial Overview and recent activity, with a direct Unassigned review and visible classification controls", async () => {
  mount("byd");
  const summary = await screen.findByLabelText("Asset financial summary");
  await within(summary).findAllByText("110,000.00");
  expect(screen.getByText("Recorded value over time")).toBeInTheDocument();
  const header = screen.getByRole("banner", { name: "Asset workspace" });
  expect(within(header).getByRole("tablist", { name: "Asset workspace" })).toBeInTheDocument();
  expect(within(header).getByText("All assets")).toBeInTheDocument();
  expect(screen.getAllByRole("tab")).toHaveLength(5);
  expect(screen.getByRole("region", { name: "Performance breakdown" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Chart view" })).toBeInTheDocument(); // monthly / yearly
  expect(screen.queryByRole("table", { name: "Recent asset transactions" })).not.toBeInTheDocument();
  expect(within(header).getByText(/Shared account · #asset_byd/)).toBeInTheDocument(); // sharing and the permanent tag moved to the header
  fireEvent.click(screen.getByRole("button", { name: /Review 1 unassigned row/ }));
  expect(screen.getByRole("button", { name: /Unassigned\s*1/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("textbox", { name: "Search entries" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Classify - on 2026-01-01" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Select all visible entries" })).toBeInTheDocument();
});
