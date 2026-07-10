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

const conn1: BrowserApiConnection = { id: "c1", label: "Home", mode: "browser-api", baseUrl: "https://s.example.com", serverPassword: "pw", budgetSyncId: "b-src" };
const conn2: BrowserApiConnection = { id: "c2", label: "Family", mode: "browser-api", baseUrl: "https://t.example.com", serverPassword: "pw", budgetSyncId: "b-tgt" };

function makeFlow(): SyncFlow {
  return {
    id: "flow-1", name: "Card sync", enabled: true, flowType: "transaction_sync", description: null, createdAt: "", updatedAt: "",
    legs: [{
      id: "leg-1", flowId: "flow-1", position: 0,
      sourceRef: { version: 1, data: { connectionFingerprint: connectionFingerprint(conn1), budgetId: "b-src", budgetName: "Home", accountId: "acct-src", accountName: "Checking" } },
      targetRef: { version: 1, data: { connectionFingerprint: connectionFingerprint(conn2), budgetId: "b-tgt", budgetName: "Family", accountId: "acct-tgt", accountName: "Joint" } },
      filter: { version: 1, data: {} }, transform: { version: 1, data: {} }, options: { version: 1, data: {} },
      createdAt: "", updatedAt: "",
    }],
  };
}

function itemFixture(overrides: Partial<SyncFlowRunItem>): SyncFlowRunItem {
  return {
    id: "i", runId: "run-1", flowId: "flow-1", legId: null, sequence: 0,
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
  opts?.onSuccess?.({ status: "draft_preview", runId: "run-1", flowId: "flow-1", counts: {}, summary: {}, warnings: [], errors: [] })
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
  it("shows the needs-connections notice when fewer than two connections exist", () => {
    setup([conn1]);
    render(<SyncView />);
    expect(screen.getByText(/needs at least two connections/i)).toBeInTheDocument();
  });

  it("counts HTTP API Server connections toward the two-connection minimum", () => {
    const httpConn: ConnectionInstance = { id: "c3", label: "Cloud", mode: "http-api", baseUrl: "https://api.example.com", apiKey: "k", budgetSyncId: "b-http" };
    setup([conn1, httpConn]);
    render(<SyncView />);
    expect(screen.queryByText(/needs at least two connections/i)).not.toBeInTheDocument();
  });

  it("opens the editor dialog with default transform (reverse sign, create payee)", async () => {
    setup([conn1, conn2]);
    render(<SyncView />);
    fireEvent.click(screen.getByRole("button", { name: /create sync flow/i }));
    expect((await screen.findByLabelText("Amount direction") as HTMLSelectElement).value).toBe("reverse");
    expect((screen.getByLabelText("Missing payee policy") as HTMLSelectElement).value).toBe("create");
  });

  it("runs a preview from the top section and renders classified rows", async () => {
    setup([conn1, conn2]);
    render(<SyncView />);
    fireEvent.click(screen.getByText("Card sync"));

    const previewButtons = await screen.findAllByRole("button", { name: /^preview$/i });
    await waitFor(() => expect(previewButtons[0]).toBeEnabled());
    fireEvent.click(previewButtons[0]);

    expect(previewMutate).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Change plan")).toBeInTheDocument();

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
    const previewButtons = await screen.findAllByRole("button", { name: /^preview$/i });
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
    // "Trigger" and "Planned" column headers are unique to the history table.
    expect(screen.getByText("Trigger")).toBeInTheDocument();
    expect(screen.getByText("Planned")).toBeInTheDocument();
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
