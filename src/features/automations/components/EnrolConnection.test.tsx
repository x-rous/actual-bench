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

  it("says what gets stored, because storing a key is a decision", async () => {
    renderPanel(httpConnection());

    fireEvent.click(await screen.findByRole("button", { name: /what gets stored/i }));

    expect(screen.getByText(/encrypted with the server/)).toBeInTheDocument();
    expect(screen.getByText(/no budget data, and no other budget/)).toBeInTheDocument();
    expect(screen.getByText(/Withdraw it whenever you like/)).toBeInTheDocument();
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

  it("explains that a Direct connection can never run unattended", async () => {
    renderPanel(httpConnection({ mode: "browser-api", label: "Local budget" }));

    expect(await screen.findByText(/is a Direct connection/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enrol/i })).not.toBeInTheDocument();
  });

  it("cannot enrol a budget the browser is not connected to, and says so", async () => {
    // The API key only exists in the session for the active connection.
    const other = httpConnection({ id: "conn-2", label: "Joint account", budgetSyncId: "budget-2" });
    renderPanel(other);

    expect(await screen.findByText(/only enrol the budget you are connected to/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enrol/i })).not.toBeInTheDocument();
  });

  it("points at the operator step when the vault is off", async () => {
    mockedSync.getVaultStatus.mockResolvedValue({ enabled: false, credentials: [] });
    renderPanel(httpConnection());

    expect(await screen.findByText(/SYNC_VAULT_KEY/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enrol/i })).not.toBeInTheDocument();
  });
});
