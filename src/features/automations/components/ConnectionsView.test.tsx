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
    vault: { status: "ready" as const },
    connections: [connection()],
  });
  mockedSync.getVaultStatus.mockResolvedValue({ vault: { status: "ready" as const }, credentials: [] });
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
      vault: { status: "ready" as const },
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

    // Everything went through: the dialog closes itself and the page updates
    // once, from its own list, without signing in to the server again.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("2 budgets enrolled");
    expect(await screen.findByText("Every budget on this server is enrolled.")).toBeInTheDocument();
    expect(mockedApi.listServerBudgets).toHaveBeenCalledTimes(1);
    // The enrolled list is re-read once for the batch, not once per budget.
    expect(mockedApi.listEnrolledConnections).toHaveBeenCalledTimes(2);
  });

  it("on a Direct server, offers to switch a budget enrolled through HTTP API (PR-071c)", async () => {
    mockedApi.listEnrolledConnections.mockResolvedValue({
      vault: { status: "ready" as const },
      connections: [connection({ mode: "browser-api", baseUrl: "https://actual.example.com" })],
    });
    mockedApi.listServerBudgets.mockResolvedValue({
      server: { mode: "browser-api", baseUrl: "https://actual.example.com" },
      budgets: [
        { budgetSyncId: "budget-2", name: "Joint", encrypted: false, enrolled: false, enrolledVia: "http-api", connectionFingerprint: "fp-2" },
      ],
    });
    mockedSync.enrollCredential.mockResolvedValue({ credential: {} as never, switchedFrom: "http-api" });
    renderView();

    expect(await screen.findByText(/Enrolled through HTTP API, can switch to Direct: Joint/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch budgets to Direct" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/select to switch to Direct/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Joint/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enrol" }));

    await waitFor(() => expect(mockedSync.enrollCredential).toHaveBeenCalled());
    expect(mockedSync.enrollCredential.mock.calls[0][0]).toMatchObject({ mode: "browser-api", budgetSyncId: "budget-2", secret: {} });
  });

  it("on an HTTP API server, shows a budget enrolled through Direct as enrolled (PR-071c)", async () => {
    mockedApi.listServerBudgets.mockResolvedValue({
      server: { mode: "http-api", baseUrl: "https://budgetapi.example.com" },
      budgets: [
        { budgetSyncId: "budget-2", name: "Joint", encrypted: false, enrolled: false, enrolledVia: "browser-api", connectionFingerprint: "fp-2" },
      ],
    });
    renderView();

    expect(await screen.findByText("Every budget on this server is enrolled.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enrol budgets on this server|Switch budgets/ })).not.toBeInTheDocument();
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
    // Something failed, so the dialog stays open, with the failed one still
    // selected and its password kept, ready to fix and retry.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Enrol" })).not.toBeDisabled();
    expect(toast.success).toHaveBeenCalledWith("Joint enrolled");
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
      vault: { status: "ready" as const },
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
    mockedApi.listEnrolledConnections.mockResolvedValue({ vault: { status: "ready" as const }, connections: [] });
    renderView();

    expect(
      await screen.findByText(/anything you schedule can only run while Bench is open/)
    ).toBeInTheDocument();
  });
});
