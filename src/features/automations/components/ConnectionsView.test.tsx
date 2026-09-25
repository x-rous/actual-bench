import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  mockedApi.listServerBudgets.mockResolvedValue({
    server: { mode: "http-api", baseUrl: "https://budgetapi.example.com" },
    budgets: [
      { budgetSyncId: "budget-1", name: "Household", encrypted: false, enrolled: true, connectionFingerprint: "fp-1" },
      { budgetSyncId: "budget-2", name: "Joint", encrypted: false, enrolled: false, connectionFingerprint: "fp-2" },
      { budgetSyncId: "budget-3", name: "Private", encrypted: true, enrolled: false, connectionFingerprint: "fp-3" },
    ],
  });
});

describe("other budgets on an enrolled server (PR-071a)", () => {
  it("lists them without being asked, once per server", async () => {
    mockedApi.listEnrolledConnections.mockResolvedValue({
      vaultEnabled: true,
      connections: [connection(), connection({ connectionFingerprint: "fp-x", budgetSyncId: "budget-x", label: "Other" })],
    });
    renderView();

    expect(await screen.findByText(/2 other budgets: Joint, Private/)).toBeInTheDocument();
    // Two enrolled budgets on one server: the server is asked once.
    expect(mockedApi.listServerBudgets).toHaveBeenCalledTimes(1);
  });

  it("enrols the chosen budgets one at a time, sending no key, and asks for an encrypted budget's password", async () => {
    mockedSync.enrollCredential.mockResolvedValue({ credential: {} as never });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Enrol budgets on this server" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Joint/ }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Private/ }));

    // An encrypted budget cannot be enrolled until its password is typed.
    const enrol = within(dialog).getByRole("button", { name: "Enrol 2 budgets" });
    expect(enrol).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Encryption password for Private"), { target: { value: "e2ee" } });
    fireEvent.click(enrol);

    await waitFor(() => expect(mockedSync.enrollCredential).toHaveBeenCalledTimes(2));
    expect(mockedSync.enrollCredential.mock.calls[0][0]).toMatchObject({
      budgetSyncId: "budget-2",
      mode: "http-api",
      secret: {},
    });
    expect(mockedSync.enrollCredential.mock.calls[1][0]).toMatchObject({
      budgetSyncId: "budget-3",
      secret: { encryptionPassword: "e2ee" },
    });
  });

  it("names a budget enrolled through the other mode instead of offering it (PR-071c)", async () => {
    mockedApi.listServerBudgets.mockResolvedValue({
      server: { mode: "http-api", baseUrl: "https://budgetapi.example.com" },
      budgets: [
        { budgetSyncId: "budget-2", name: "Joint", encrypted: false, enrolled: false, enrolledVia: "browser-api", connectionFingerprint: "fp-2" },
      ],
    });
    renderView();

    expect(await screen.findByText(/Already enrolled another way: Joint \(through Direct\)/)).toBeInTheDocument();
    expect(screen.getByText("Every budget on this server is enrolled.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enrol budgets on this server" })).not.toBeInTheDocument();
  });

  it("shows a failure on its row and lets the others through", async () => {
    mockedSync.enrollCredential
      .mockRejectedValueOnce(new Error("The encryption password is not correct."))
      .mockResolvedValueOnce({ credential: {} as never });
    mockedApi.listServerBudgets.mockResolvedValue({
      server: { mode: "http-api", baseUrl: "https://budgetapi.example.com" },
      budgets: [
        { budgetSyncId: "budget-3", name: "Private", encrypted: true, enrolled: false, connectionFingerprint: "fp-3" },
        { budgetSyncId: "budget-2", name: "Joint", encrypted: false, enrolled: false, connectionFingerprint: "fp-2" },
      ],
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Enrol budgets on this server" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Private/ }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Joint/ }));
    fireEvent.change(within(dialog).getByLabelText("Encryption password for Private"), { target: { value: "wrong" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enrol 2 budgets" }));

    expect(await within(dialog).findByText("The encryption password is not correct.")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getAllByText("Enrolled")).toHaveLength(1));
    // The failed one is still selected, with its password, ready to fix and retry.
    expect(within(dialog).getByRole("button", { name: "Enrol" })).not.toBeDisabled();
  });
});

describe("unattended access", () => {
  it("lists each enrolled budget with the server it belongs to", async () => {
    renderView();

    expect(await screen.findByText("Household")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("https://budgetapi.example.com")).toBeInTheDocument();
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
