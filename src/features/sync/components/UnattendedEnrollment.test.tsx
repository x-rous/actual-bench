import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import type { ConnectionInstance } from "@/store/connection";
import * as syncApi from "../lib/syncApi";
import { UnattendedEnrollment } from "./UnattendedEnrollment";

jest.mock("../lib/syncApi");
jest.mock("../hooks/useFlowAutomations", () => ({ useFlowAutomations: () => new Map() }));

const mockedSync = syncApi as jest.Mocked<typeof syncApi>;

const source = {
  id: "src",
  label: "Envelope",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  budgetSyncId: "budget-1",
  serverPassword: "server-pw",
} as ConnectionInstance;

const target = {
  id: "tgt",
  label: "Household",
  mode: "http-api",
  baseUrl: "https://api.example.com",
  budgetSyncId: "budget-2",
  apiKey: "key-2",
} as ConnectionInstance;

function renderPanel(src: ConnectionInstance, tgt: ConnectionInstance) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UnattendedEnrollment
        sourceConnection={src}
        targetConnection={tgt}
        intervalMinutes={60}
        flowEnabled
        autoPaused={false}
      />
    </QueryClientProvider>
  );
}

describe("enrolling a flow's budgets for unattended sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSync.enrollCredential.mockResolvedValue({ credential: {} as never });
  });

  it("enrols a Direct and an HTTP API budget, each with its own kind of secret, skipping one already enrolled", async () => {
    mockedSync.getVaultStatus.mockResolvedValue({
      vault: { status: "ready" as const },
      credentials: [{ connectionFingerprint: connectionFingerprint(target) } as never],
    });
    renderPanel(source, target);

    fireEvent.click(await screen.findByRole("button", { name: /store credentials/i }));

    await waitFor(() => expect(mockedSync.enrollCredential).toHaveBeenCalledTimes(1));
    expect(mockedSync.enrollCredential.mock.calls[0][0]).toMatchObject({
      mode: "browser-api",
      budgetSyncId: "budget-1",
      secret: { serverPassword: "server-pw" },
    });
  });

  it("removes a budget's enrolment through the other mode, which the panel counts as enrolled", async () => {
    // The source is connected Direct here but enrolled through HTTP API.
    const sourceViaHttp = connectionFingerprint({ mode: "http-api", baseUrl: "https://api.example.com", budgetSyncId: "budget-1" });
    mockedSync.getVaultStatus.mockResolvedValue({
      vault: { status: "ready" as const },
      credentials: [
        { connectionFingerprint: sourceViaHttp, budgetSyncId: "budget-1" } as never,
        { connectionFingerprint: connectionFingerprint(target), budgetSyncId: "budget-2" } as never,
      ],
    });
    mockedSync.withdrawCredential.mockResolvedValue(undefined as never);
    renderPanel(source, target);

    fireEvent.click(await screen.findByRole("button", { name: /remove stored credentials/i }));

    await waitFor(() => expect(mockedSync.withdrawCredential).toHaveBeenCalledTimes(2));
    expect(mockedSync.withdrawCredential).toHaveBeenCalledWith(sourceViaHttp);
    expect(mockedSync.withdrawCredential).toHaveBeenCalledWith(connectionFingerprint(target));
  });

  it("no longer says Direct connections cannot run unattended", async () => {
    mockedSync.getVaultStatus.mockResolvedValue({ vault: { status: "ready" as const }, credentials: [] });
    renderPanel(source, { ...source, id: "src-2", budgetSyncId: "budget-3" } as ConnectionInstance);

    expect(await screen.findByRole("button", { name: /store credentials/i })).toBeInTheDocument();
    expect(screen.queryByText(/must be HTTP API/i)).not.toBeInTheDocument();
  });
});
