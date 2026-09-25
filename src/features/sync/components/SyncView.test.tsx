import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { SyncView } from "./SyncView";
import * as flowsHook from "../hooks/useSyncFlows";
import * as dataHook from "../hooks/useSyncData";
import * as orchestrationHook from "../hooks/useSyncOrchestration";
import type { BrowserApiConnection, ConnectionInstance } from "@/store/connection";
import type { SyncFlow, SyncFlowRunItem } from "@/lib/app-db/types";

jest.mock("../hooks/useSyncFlows");
jest.mock("../hooks/useSyncData");
jest.mock("../hooks/useSyncOrchestration");
// The interval scheduler starts real timers; stub it out for component tests.
jest.mock("../hooks/useSyncScheduler", () => ({ useSyncScheduler: jest.fn() }));
jest.mock("../hooks/useFlowAutomations", () => ({ useFlowAutomations: () => new Map() }));
// No saved budgets by default; one test gives the editor a saved budget.
const savedConnector = { saved: [] as unknown[], locked: false, connecting: false, connect: jest.fn(), dialog: null };
jest.mock("@/features/connect/useSavedBudgetConnector", () => ({
  useSavedBudgetConnector: () => savedConnector,
}));

const conn1: BrowserApiConnection = { id: "c1", label: "Home", mode: "browser-api", baseUrl: "https://s.example.com", serverPassword: "pw", budgetSyncId: "b-src" };
const conn2: BrowserApiConnection = { id: "c2", label: "Family", mode: "browser-api", baseUrl: "https://t.example.com", serverPassword: "pw", budgetSyncId: "b-tgt" };

function makeFlow(): SyncFlow {
  return {
    id: "flow-1", name: "Card sync", enabled: true, flowType: "transaction_sync", description: null, createdAt: "", updatedAt: "",
    sourceRef: { version: 1, data: { connectionFingerprint: connectionFingerprint(conn1), budgetId: "b-src", budgetName: "Home", accountId: "acct-src", accountName: "Checking" } },
    targetRef: { version: 1, data: { connectionFingerprint: connectionFingerprint(conn2), budgetId: "b-tgt", budgetName: "Family", accountId: "acct-tgt", accountName: "Joint" } },
    filter: { version: 1, data: {} }, transform: { version: 1, data: {} }, options: { version: 1, data: {} },
  };
}

function itemFixture(overrides: Partial<SyncFlowRunItem>): SyncFlowRunItem {
  return {
    id: "i", runId: "run-1", flowId: "flow-1", sequence: 0,
    sourceItemRef: { version: 1, data: { itemKey: "txn:t1", source: { date: "2026-07-01", amount: -1250, payeeName: "Coffee Bar", categoryName: "Dining" } } },
    targetItemRef: null, status: "planned", message: null,
    sourceEntityType: "transaction", sourceItemKey: "txn:t1", sourceTransactionId: "t1", sourceSplitId: null, sourceFingerprint: "fp",
    plannedAction: "create", plannedTargetPayload: { version: 1, data: { date: "2026-07-01", amount: 1250, payeeName: "Coffee Bar", categoryId: "tc1", notes: "n" } },
    classification: "new", duplicateConfidence: "none", warnings: { version: 1, data: { flags: [] } }, errors: null,
    selectedForApply: true, applyState: "pending", createdTargetTransactionId: null, createdTargetMarker: null,
    createdAt: "", updatedAt: null, ...overrides,
  };
}

const runFixture = {
  run: {
    id: "run-1", flowId: "flow-1", status: "draft_preview", startedAt: "2026-07-01T00:00:00.000Z", finishedAt: null,
    summary: { version: 1, data: { sourceItemsScanned: 45, generatedTransactionsExcluded: 3, sourceItemsFilteredOut: 12, createCandidates: 1, blocked: 1 } },
    error: null, createdByTrigger: "manual_preview" as const, sourceSnapshotSummary: null, targetSnapshotSummary: null, counts: null,
  },
  items: [
    itemFixture({ id: "new-1", classification: "new", plannedAction: "create" }),
    itemFixture({ id: "blocked-1", classification: "blocked", plannedAction: "blocked", plannedTargetPayload: null }),
  ],
};

const previewMutate = jest.fn((_args, opts?: { onSuccess?: (r: unknown) => void }) =>
  opts?.onSuccess?.({ status: "draft_preview", runId: "run-1", flowId: "flow-1", counts: {}, summary: {}, warnings: [], errors: [], items: runFixture.items })
);
const applyMutate = jest.fn((_args, opts?: { onSuccess?: (r: unknown) => void }) =>
  opts?.onSuccess?.({ status: "applied", runId: "run-1", counts: { selected: 1, applied: 1, appliedWithWarnings: 0, repaired: 0, skipped: 0, failed: 0 }, items: [] })
);
let createMutate: jest.Mock;

function setup(connections: ConnectionInstance[]) {
  createMutate = jest.fn();
  (dataHook.useSyncConnections as jest.Mock).mockReturnValue(connections);
  (dataHook.useFlowAccounts as jest.Mock).mockReturnValue({ data: [{ id: "acct-src", name: "Checking" }, { id: "acct-tgt", name: "Joint" }], isLoading: false });
  (dataHook.useSyncRun as jest.Mock).mockImplementation((runId: string | null) => ({ data: runId ? runFixture : undefined, refetch: jest.fn() }));
  (dataHook.useFlowRuns as jest.Mock).mockImplementation((flowId: string | null) => ({ data: flowId ? [runFixture.run] : [], refetch: jest.fn() }));
  (dataHook.useLatestRunByFlow as jest.Mock).mockReturnValue({ data: new Map([["flow-1", runFixture.run]]), refetch: jest.fn() });
  (flowsHook.useSyncFlows as jest.Mock).mockReturnValue({ data: [makeFlow()], refetch: jest.fn() });
  (flowsHook.useSyncFlowMutations as jest.Mock).mockReturnValue({
    create: { mutate: createMutate, isPending: false },
    update: { mutate: jest.fn(), isPending: false },
    remove: { mutate: jest.fn(), isPending: false },
  });
  (orchestrationHook.usePreviewMutation as jest.Mock).mockReturnValue({ mutate: previewMutate, isPending: false });
  (orchestrationHook.useApplyMutation as jest.Mock).mockReturnValue({ mutate: applyMutate, isPending: false });
  (orchestrationHook.useSafeSyncMutation as jest.Mock).mockReturnValue({ mutate: jest.fn(), isPending: false });
}

beforeEach(() => jest.clearAllMocks());

describe("SyncView", () => {
  it("shows the needs-connections notice only when there are no connections", () => {
    setup([]);
    render(<SyncView />);
    expect(screen.getByText(/needs a connection/i)).toBeInTheDocument();
  });

  it("opens the workspace with a single connection (same-budget sync needs only one)", () => {
    setup([conn1]);
    render(<SyncView />);
    expect(screen.queryByText(/needs a connection/i)).not.toBeInTheDocument();
  });

  it("opens the workspace with an HTTP API Server connection", () => {
    const httpConn: ConnectionInstance = { id: "c3", label: "Cloud", mode: "http-api", baseUrl: "https://api.example.com", apiKey: "k", budgetSyncId: "b-http" };
    setup([conn1, httpConn]);
    render(<SyncView />);
    expect(screen.queryByText(/needs a connection/i)).not.toBeInTheDocument();
  });

  it("recognizes open flow budgets when the live connection details changed", () => {
    const httpSource: ConnectionInstance = { id: "http-src", label: "Home", mode: "http-api", baseUrl: "https://api.example.com", apiKey: "k", budgetSyncId: "b-src" };
    const httpTarget: ConnectionInstance = { id: "http-tgt", label: "Family", mode: "http-api", baseUrl: "https://api.example.com", apiKey: "k", budgetSyncId: "b-tgt" };
    setup([httpSource, httpTarget]);

    render(<SyncView />);

    expect(screen.queryByText("Needs connection")).not.toBeInTheDocument();
  });

  it("still flags a flow when one of its budgets is not open", () => {
    setup([conn1]);

    render(<SyncView />);

    expect(screen.getByText("Needs connection")).toBeInTheDocument();
  });

  it("does not ask for connections for a flow that runs on the server with both budgets enrolled", () => {
    setup([conn1]);
    const flow = makeFlow();
    (flowsHook.useSyncFlows as jest.Mock).mockReturnValue({
      data: [{ ...flow, options: { version: 1, data: { reviewPolicy: "auto_sync_unattended" } } }],
      refetch: jest.fn(),
    });
    (dataHook.useVaultStatus as jest.Mock).mockReturnValue({
      data: {
        vault: { status: "ready" as const },
        credentials: [
          { connectionFingerprint: connectionFingerprint(conn1) },
          { connectionFingerprint: connectionFingerprint(conn2) },
        ],
      },
    });

    render(<SyncView />);

    // Its target budget is not open in this tab, and that is fine: it runs on the server.
    expect(screen.queryByText("Needs connection")).not.toBeInTheDocument();

    // The header says where it runs, and the editor still shows the budget it uses.
    fireEvent.click(screen.getByText("Card sync"));
    expect(screen.getByText("runs on the server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit flow" }));
    expect(screen.getByText("Family / Joint")).toBeInTheDocument();
    expect(screen.getByText("Connect this budget to change it.")).toBeInTheDocument();
  });

  it("connects a flow's saved budget with one click, keeping the flow's own connection (PR-071b)", async () => {
    setup([conn1]);
    const flow = makeFlow();
    (flowsHook.useSyncFlows as jest.Mock).mockReturnValue({
      data: [{ ...flow, options: { version: 1, data: { reviewPolicy: "auto_sync_unattended" } } }],
      refetch: jest.fn(),
    });
    const saved = { serverFingerprint: "srv-t", budgetSyncId: "b-tgt", name: "Family", mode: "browser-api", baseUrl: conn2.baseUrl, serverLabel: "t" };
    savedConnector.saved = [saved];
    savedConnector.connect.mockResolvedValue({ ...conn2, id: "c2-new" });
    try {
      render(<SyncView />);
      fireEvent.click(screen.getByText("Card sync"));
      fireEvent.click(screen.getByRole("button", { name: "Edit flow" }));
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));

      await waitFor(() => expect(savedConnector.connect).toHaveBeenCalledWith(saved));
      // Connected: the endpoint is editable again rather than read-only.
      await waitFor(() => expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument());
    } finally {
      savedConnector.saved = [];
    }
  });

  it("does not offer to run a disabled server flow, which the server would refuse", () => {
    setup([conn1]);
    const flow = makeFlow();
    (flowsHook.useSyncFlows as jest.Mock).mockReturnValue({
      data: [{ ...flow, enabled: false, options: { version: 1, data: { reviewPolicy: "auto_sync_unattended" } } }],
      refetch: jest.fn(),
    });
    (dataHook.useVaultStatus as jest.Mock).mockReturnValue({
      data: {
        vault: { status: "ready" as const },
        credentials: [
          { connectionFingerprint: connectionFingerprint(conn1) },
          { connectionFingerprint: connectionFingerprint(conn2) },
        ],
      },
    });

    render(<SyncView />);
    fireEvent.click(screen.getByText("Card sync"));

    expect(screen.getByRole("button", { name: /run safe sync/i })).toBeDisabled();
  });

  it("opens the editor dialog with default transform (same sign, create payee)", async () => {
    setup([conn1, conn2]);
    render(<SyncView />);
    fireEvent.click(screen.getByRole("button", { name: /create sync flow/i }));
    expect((await screen.findByLabelText("Amount direction") as HTMLSelectElement).value).toBe("same");
    expect((screen.getByLabelText("Missing payee policy") as HTMLSelectElement).value).toBe("create");
  });

  it("runs a preview from the top section and renders classified rows", async () => {
    setup([conn1, conn2]);
    render(<SyncView />);
    fireEvent.click(screen.getByText("Card sync"));

    const previewButtons = await screen.findAllByRole("button", { name: /^sync preview$/i });
    await waitFor(() => expect(previewButtons[0]).toBeEnabled());
    fireEvent.click(previewButtons[0]);

    expect(previewMutate).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Planned changes")).toBeInTheDocument();

    const rows = screen.getAllByTestId("preview-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("checkbox")).toBeEnabled();  // new
    expect(within(rows[1]).getByRole("checkbox")).toBeDisabled(); // blocked
    expect(within(rows[0]).getByRole("checkbox")).toBeChecked();
  });

  it("applies selected changes and renders the apply result", async () => {
    setup([conn1, conn2]);
    render(<SyncView />);
    fireEvent.click(screen.getByText("Card sync"));
    const previewButtons = await screen.findAllByRole("button", { name: /^sync preview$/i });
    await waitFor(() => expect(previewButtons[0]).toBeEnabled());
    fireEvent.click(previewButtons[0]);

    const applyButton = await screen.findByRole("button", { name: /sync selected/i });
    fireEvent.click(applyButton);

    expect(applyMutate).toHaveBeenCalledTimes(1);
    expect(applyMutate.mock.calls[0][0]).toMatchObject({ runId: "run-1", selection: { selectedItemIds: ["new-1"] } });
    expect(await screen.findByText(/Synced\./i)).toBeInTheDocument();
  });

  it("shows run history when Run history is clicked", async () => {
    setup([conn1, conn2]);
    render(<SyncView />);
    fireEvent.click(screen.getByText("Card sync"));
    fireEvent.click(await screen.findByRole("button", { name: /history/i }));
    expect(await screen.findByRole("button", { name: /back to flow/i })).toBeInTheDocument();
    // "Trigger" and "Result" column headers are unique to the history table.
    expect(screen.getByText("Trigger")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("makes a run opened from history read-only (no apply)", async () => {
    setup([conn1, conn2]);
    render(<SyncView />);
    fireEvent.click(screen.getByText("Card sync"));
    fireEvent.click(await screen.findByRole("button", { name: /history/i }));
    // click the historical run row
    fireEvent.click(await screen.findByText("Preview only"));

    expect(await screen.findByText(/read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sync selected/i })).not.toBeInTheDocument();
    // rows are present but their checkboxes are disabled
    const rows = screen.getAllByTestId("preview-row");
    expect(within(rows[0]).getByRole("checkbox")).toBeDisabled();
  });

  it("does not show a live preview's items under a different run opened from history", async () => {
    // The live preview response carries rows the database never stored, so it
    // is preferred over the DB read - but only for the run it came from. Held
    // loose, it was used for whichever run was on screen, so opening an older
    // draft preview after running a live one listed (and exported) the live
    // run's items under the older run's heading.
    setup([conn1, conn2]);
    const historical = {
      run: { ...runFixture.run, id: "run-2", startedAt: "2026-06-01T00:00:00.000Z" },
      items: [itemFixture({ id: "historical-1", sourceItemKey: "txn:historical" })],
    };
    (dataHook.useSyncRun as jest.Mock).mockImplementation((id: string | null) => ({
      data: id === "run-2" ? historical : id ? runFixture : undefined,
      refetch: jest.fn(),
    }));
    (dataHook.useFlowRuns as jest.Mock).mockImplementation((flowId: string | null) => ({
      data: flowId ? [historical.run] : [],
      refetch: jest.fn(),
    }));

    render(<SyncView />);
    fireEvent.click(screen.getByText("Card sync"));

    const previewButtons = await screen.findAllByRole("button", { name: /^sync preview$/i });
    await waitFor(() => expect(previewButtons[0]).toBeEnabled());
    fireEvent.click(previewButtons[0]);
    expect(await screen.findByText("Planned changes")).toBeInTheDocument();
    expect(screen.getAllByTestId("preview-row")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    fireEvent.click(await screen.findByText("Preview only"));

    // run-2 holds exactly one item; the live run's two must not carry over.
    await waitFor(() => expect(screen.getAllByTestId("preview-row")).toHaveLength(1));
  });

  it("shows what the database holds when history opens the run just previewed", async () => {
    // Same run, so the ids match - but history has to show the stored rows
    // regardless. The audit CSV is exported from these, and an export that
    // depends on whose session is looking is not an audit.
    setup([conn1, conn2]);
    previewMutate.mockImplementationOnce((_args, opts?: { onSuccess?: (r: unknown) => void }) =>
      opts?.onSuccess?.({
        status: "draft_preview",
        runId: "run-1",
        flowId: "flow-1",
        counts: {},
        summary: {},
        warnings: [],
        errors: [],
        // The extra row the database deliberately never stored.
        items: [...runFixture.items, itemFixture({ id: "synced-1", classification: "already_synced" })],
      })
    );

    render(<SyncView />);
    fireEvent.click(screen.getByText("Card sync"));
    const previewButtons = await screen.findAllByRole("button", { name: /^sync preview$/i });
    await waitFor(() => expect(previewButtons[0]).toBeEnabled());
    fireEvent.click(previewButtons[0]);

    // The live preview sees all three, which is the whole point of holding them.
    expect(await screen.findByText("Planned changes")).toBeInTheDocument();
    expect(screen.getAllByTestId("preview-row")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    fireEvent.click(await screen.findByText("Preview only"));

    // Opened from history, the same run reads back as the database has it.
    await waitFor(() => expect(screen.getAllByTestId("preview-row")).toHaveLength(2));
  });

  it("creates a reverse flow with source and target swapped from the header", async () => {
    setup([conn1, conn2]);
    render(<SyncView />);
    fireEvent.click(screen.getByText("Card sync"));

    const reverseButton = await screen.findByRole("button", { name: /create reverse flow/i });
    fireEvent.click(reverseButton);

    expect(createMutate).toHaveBeenCalledTimes(1);
    const payload = createMutate.mock.calls[0][0] as { name: string; enabled: boolean; legs: Array<Record<string, { data: Record<string, unknown> }>> };
    expect(payload.name).toBe("Card sync (reverse)");
    expect(payload.enabled).toBe(false);
    expect(payload.legs[0].sourceRef.data.accountId).toBe("acct-tgt");
    expect(payload.legs[0].targetRef.data.accountId).toBe("acct-src");
  });
});
