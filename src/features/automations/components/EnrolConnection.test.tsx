import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EnrolConnection } from "./EnrolConnection";
import * as syncApi from "../../sync/lib/syncApi";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { useConnectionStore } from "@/store/connection";
import type { ConnectionInstance } from "@/store/connection";

jest.mock("../../sync/lib/syncApi");
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn() },
}));

const mockedSync = syncApi as jest.Mocked<typeof syncApi>;

function httpConnection(overrides: Partial<ConnectionInstance> = {}): ConnectionInstance {
  return {
    id: "conn-1",
    label: "Household",
    mode: "http-api",
    baseUrl: "https://budgetapi.example.com",
    budgetSyncId: "budget-1",
    apiKey: "key-123",
    encryptionPassword: "",
    ...overrides,
  } as ConnectionInstance;
}

function renderPanel(connection: ConnectionInstance | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EnrolConnection connection={connection} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedSync.getVaultStatus.mockResolvedValue({ enabled: true, credentials: [] });
  const connection = httpConnection();
  useConnectionStore.setState({ instances: [connection], activeInstanceId: connection.id });
});

describe("enrolling a budget for unattended access", () => {
  it("offers to enrol the budget you are connected to, in place", async () => {
    mockedSync.enrollCredential.mockResolvedValue({ credential: {} as never });
    renderPanel(httpConnection());

    fireEvent.click(await screen.findByRole("button", { name: /enrol household/i }));

    await waitFor(() => expect(mockedSync.enrollCredential).toHaveBeenCalled());
    const payload = mockedSync.enrollCredential.mock.calls[0][0];
    expect(payload).toMatchObject({
      mode: "http-api",
      baseUrl: "https://budgetapi.example.com",
      budgetSyncId: "budget-1",
      secret: { apiKey: "key-123" },
    });
  });

  it("says what gets saved, because saving a key is a decision", async () => {
    renderPanel(httpConnection());

    fireEvent.click(await screen.findByRole("button", { name: /what gets saved/i }));

    // The reassurance is in the same sentence as what is saved.
    expect(screen.getByText(/This budget\u2019s API key is encrypted with Bench/)).toBeInTheDocument();
    expect(screen.getByText(/someone with a copy of the\s+database cannot read the API key/)).toBeInTheDocument();
    expect(screen.getByText(/never shown again or sent to\s+your browser/)).toBeInTheDocument();
    expect(screen.getByText(/No budget data is saved/)).toBeInTheDocument();
    expect(screen.getByText(/If you change the API key, automations for budgets on that\s+server stop running/)).toBeInTheDocument();
    expect(screen.getByText(/in Automations \u2192 Connections at any time/)).toBeInTheDocument();
  });

  it("says nothing at all once the budget is enrolled", async () => {
    const connection = httpConnection();
    mockedSync.getVaultStatus.mockResolvedValue({
      enabled: true,
      credentials: [{ connectionFingerprint: connectionFingerprint(connection) } as never],
    });

    const { container } = renderPanel(connection);

    await waitFor(() => expect(mockedSync.getVaultStatus).toHaveBeenCalled());
    // A panel that keeps explaining a solved problem is noise in every dialog
    // that embeds it.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("does not offer a Direct connection where nothing can use it yet", async () => {
    renderPanel(httpConnection({ mode: "browser-api", label: "Local budget" }));

    expect(await screen.findByText(/is a Direct connection/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enrol/i })).not.toBeInTheDocument();
  });

  it("enrols a Direct connection with its server password where it is allowed", async () => {
    let finish: (value: { credential: never }) => void = () => {};
    mockedSync.enrollCredential.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const direct = {
      id: "conn-1",
      label: "Envelope",
      mode: "browser-api",
      baseUrl: "https://actual.example.com",
      budgetSyncId: "budget-1",
      serverPassword: "server-pw",
      encryptionPassword: "e2ee-pw",
    } as ConnectionInstance;
    useConnectionStore.setState({ instances: [direct], activeInstanceId: direct.id });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <EnrolConnection connection={direct} allowDirect />
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: /enrol envelope/i }));

    // The check opens the budget, so it says it is checking and that nothing is saved if it fails.
    expect(await screen.findByRole("status")).toHaveTextContent(/Nothing is saved if the check fails/);
    expect(mockedSync.enrollCredential.mock.calls[0][0]).toMatchObject({
      mode: "browser-api",
      secret: { serverPassword: "server-pw", encryptionPassword: "e2ee-pw" },
    });
    expect(mockedSync.enrollCredential.mock.calls[0][0].secret).not.toHaveProperty("apiKey");
    finish({ credential: {} as never });
  });

  it("explains what is saved for a Direct connection", async () => {
    const direct = { ...httpConnection(), mode: "browser-api", serverPassword: "pw" } as ConnectionInstance;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <EnrolConnection connection={direct} allowDirect onConnectionsPage />
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: /what gets saved/i }));

    expect(screen.getByText(/Your Actual server password is encrypted with Bench/)).toBeInTheDocument();
    expect(screen.getByText(/cannot read the password. Keep the vault key private/)).toBeInTheDocument();
    expect(
      screen.getByText(/If you change your Actual server password, automations for budgets on that\s+server stop running/)
    ).toBeInTheDocument();
    expect(screen.getByText(/on this page at any time/)).toBeInTheDocument();
  });

  it("enrols a budget connected in this session even when it is not the open one", async () => {
    mockedSync.enrollCredential.mockResolvedValue({ credential: {} as never });
    // The browser holds each connected budget's key for the session.
    const other = httpConnection({ id: "conn-2", label: "Joint account", budgetSyncId: "budget-2", apiKey: "key-2" });
    renderPanel(other);

    fireEvent.click(await screen.findByRole("button", { name: /enrol joint account/i }));

    await waitFor(() => expect(mockedSync.enrollCredential).toHaveBeenCalled());
    expect(mockedSync.enrollCredential.mock.calls[0][0]).toMatchObject({
      budgetSyncId: "budget-2",
      secret: { apiKey: "key-2" },
    });
  });

  it("says a budget is already set up through the other mode, and can still be enrolled (PR-071c)", async () => {
    mockedSync.getVaultStatus.mockResolvedValue({
      enabled: true,
      credentials: [{ connectionFingerprint: "direct-fp", budgetSyncId: "budget-1", mode: "browser-api" } as never],
    });
    mockedSync.enrollCredential.mockResolvedValue({ credential: {} as never });
    renderPanel(httpConnection());

    expect(await screen.findByText(/already set up for scheduled runs through Direct/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enrol household/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /enrol this connection anyway/i }));
    fireEvent.click(await screen.findByRole("button", { name: /enrol household/i }));
    await waitFor(() => expect(mockedSync.enrollCredential).toHaveBeenCalled());
  });

  it("points at the operator step when the vault is off", async () => {
    mockedSync.getVaultStatus.mockResolvedValue({ enabled: false, credentials: [] });
    renderPanel(httpConnection());

    expect(await screen.findByText(/SYNC_VAULT_KEY/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enrol/i })).not.toBeInTheDocument();
  });
});
