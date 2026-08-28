import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { ConnectionsView } from "./ConnectionsView";
import * as api from "../lib/automationsApi";
import * as syncApi from "../../sync/lib/syncApi";
import { useConnectionStore } from "@/store/connection";
import type { EnrolledConnection } from "../lib/automationsApi";

jest.mock("../lib/automationsApi");
jest.mock("../../sync/lib/syncApi");
jest.mock("next/navigation", () => ({ usePathname: () => "/automations/connections" }));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn() },
}));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedSync = syncApi as jest.Mocked<typeof syncApi>;

function connection(overrides: Partial<EnrolledConnection> = {}): EnrolledConnection {
  return {
    connectionFingerprint: "fp-1",
    label: "Household",
    baseUrl: "https://budgetapi.example.com",
    budgetSyncId: "budget-1",
    mode: "http-api",
    enrolledAt: "2026-08-12T09:00:00.000Z",
    usedBy: [
      { id: "auto-1", name: "Nightly backup", type: "backup", typeLabel: "Backup", enabled: true },
    ],
    ...overrides,
  };
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConnectionsView />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useConnectionStore.setState({ instances: [], activeInstanceId: null });
  mockedApi.listEnrolledConnections.mockResolvedValue({
    vaultEnabled: true,
    connections: [connection()],
  });
  mockedSync.getVaultStatus.mockResolvedValue({ enabled: true, credentials: [] });
});

describe("unattended access", () => {
  it("lists each enrolled budget with the server it belongs to", async () => {
    renderView();

    expect(await screen.findByText("Household")).toBeInTheDocument();
    expect(screen.getByText("https://budgetapi.example.com")).toBeInTheDocument();
  });

  it("says what depends on a credential, which is the point of the page", async () => {
    renderView();
    expect(await screen.findByRole("link", { name: "Nightly backup" })).toBeInTheDocument();
  });

  it("names what will stop before withdrawing anything", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /withdraw/i }));

    expect(await screen.findByText('Withdraw access to "Household"?')).toBeInTheDocument();
    // Named, not counted: "1 automation will stop" is not enough to decide with.
    expect(
      screen.getByText(/1 automation\(s\) rely on it - Nightly backup - and will stop/)
    ).toBeInTheDocument();
    expect(mockedSync.withdrawCredential).not.toHaveBeenCalled();
  });

  it("says plainly when nothing is using a credential", async () => {
    mockedApi.listEnrolledConnections.mockResolvedValue({
      vaultEnabled: true,
      connections: [connection({ usedBy: [] })],
    });

    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /withdraw/i }));

    expect(await screen.findByText(/Nothing is using it, so nothing stops/)).toBeInTheDocument();
  });

  it("withdraws once confirmed", async () => {
    mockedSync.withdrawCredential.mockResolvedValue({ ok: true });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: /withdraw/i }));
    // The dialog's own confirm button, not the row's.
    const confirmButtons = await screen.findAllByRole("button", { name: /^withdraw$/i });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    // React Query passes its own context as a second argument.
    await waitFor(() =>
      expect(mockedSync.withdrawCredential).toHaveBeenCalledWith("fp-1", expect.anything())
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("explains the empty case rather than showing a bare table", async () => {
    mockedApi.listEnrolledConnections.mockResolvedValue({ vaultEnabled: true, connections: [] });
    renderView();

    expect(
      await screen.findByText(/anything you schedule can only run while Bench is open/)
    ).toBeInTheDocument();
  });
});
