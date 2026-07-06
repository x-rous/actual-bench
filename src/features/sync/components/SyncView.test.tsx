import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { SyncView } from "./SyncView";
import * as flowsHook from "../hooks/useSyncFlows";
import * as dataHook from "../hooks/useSyncData";
import * as orchestrationHook from "../hooks/useSyncOrchestration";
import type { BrowserApiConnection } from "@/store/connection";
import type { SyncFlow, SyncFlowRunItem } from "@/lib/app-db/types";

jest.mock("../hooks/useSyncFlows");
jest.mock("../hooks/useSyncData");
jest.mock("../hooks/useSyncOrchestration");

const conn1: BrowserApiConnection = { id: "c1", label: "Home", mode: "browser-api", baseUrl: "https://s.example.com", serverPassword: "pw", budgetSyncId: "b-src" };
const conn2: BrowserApiConnection = { id: "c2", label: "Family", mode: "browser-api", baseUrl: "https://t.example.com", serverPassword: "pw", budgetSyncId: "b-tgt" };

function makeFlow(): SyncFlow {
  return {
    id: "flow-1", name: "Card sync", enabled: true, flowType: "transaction_sync", description: null, createdAt: "", updatedAt: "",
    legs: [{
      id: "leg-1", flowId: "flow-1", position: 0,
      sourceRef: { version: 1, data: { connectionFingerprint: connectionFingerprint(conn1), budgetId: "b-src", budgetName: "Home", accountId: "acct-src", accountName: "Checking" } },
      targetRef: { version: 1, data: { connectionFingerprint: connectionFingerprint(conn2), budgetId: "b-tgt", accountId: "acct-tgt" } },
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
    summary: { version: 1, data: { sourceTransactionsScanned: 3, createCandidates: 1, blocked: 1 } },
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
  opts?.onSuccess?.({
    status: "applied", runId: "run-1", counts: { selected: 1, applied: 1, appliedWithWarnings: 0, repaired: 0, skipped: 0, failed: 0 }, items: [],
  })
);

function setup(connections: BrowserApiConnection[]) {
  (dataHook.useDirectConnections as jest.Mock).mockReturnValue(connections);
  (dataHook.useFlowAccounts as jest.Mock).mockReturnValue({ data: [{ id: "acct-src", name: "Checking" }, { id: "acct-tgt", name: "Joint" }], isLoading: false });
  (dataHook.useSyncRun as jest.Mock).mockImplementation((runId: string | null) => ({ data: runId ? runFixture : undefined, refetch: jest.fn() }));
  (dataHook.useFlowRuns as jest.Mock).mockImplementation((flowId: string | null) => ({ data: flowId ? [runFixture.run] : [], refetch: jest.fn() }));
  (flowsHook.useSyncFlows as jest.Mock).mockReturnValue({ data: [makeFlow()], refetch: jest.fn() });
  (flowsHook.useSyncFlowMutations as jest.Mock).mockReturnValue({
    create: { mutate: jest.fn(), isPending: false },
    update: { mutate: jest.fn(), isPending: false },
    remove: { mutate: jest.fn(), isPending: false },
  });
  (orchestrationHook.usePreviewMutation as jest.Mock).mockReturnValue({ mutate: previewMutate, isPending: false });
  (orchestrationHook.useApplyMutation as jest.Mock).mockReturnValue({ mutate: applyMutate, isPending: false });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("SyncView", () => {
  it("shows the Direct-only notice when fewer than two Direct connections exist", () => {
    setup([conn1]);
    render(<SyncView />);
    expect(screen.getByText(/supports Direct mode only/i)).toBeInTheDocument();
  });

  it("renders the flow list and editor defaults (reverse sign, create payee)", () => {
    setup([conn1, conn2]);
    render(<SyncView />);
    expect(screen.getByText("Card sync")).toBeInTheDocument();
    expect((screen.getByLabelText("Amount direction") as HTMLSelectElement).value).toBe("reverse");
    expect((screen.getByLabelText("Missing payee policy") as HTMLSelectElement).value).toBe("create");
    expect((screen.getByLabelText("Add notes marker") as HTMLInputElement).checked).toBe(true);
  });

  it("runs a preview, renders the summary and classified rows, and only new rows are selectable", async () => {
    setup([conn1, conn2]);
    render(<SyncView />);

    fireEvent.click(screen.getByText("Card sync"));

    const previewButton = await screen.findByRole("button", { name: /run preview/i });
    await waitFor(() => expect(previewButton).toBeEnabled());
    fireEvent.click(previewButton);

    expect(previewMutate).toHaveBeenCalledTimes(1);

    // summary + rows
    expect(await screen.findByText("Preview summary")).toBeInTheDocument();
    const rows = screen.getAllByTestId("preview-row");
    expect(rows).toHaveLength(2);

    // new row selectable, blocked row not
    const newRow = within(rows[0]).getByRole("checkbox");
    const blockedRow = within(rows[1]).getByRole("checkbox");
    expect(newRow).toBeEnabled();
    expect(blockedRow).toBeDisabled();
    expect(newRow).toBeChecked(); // default select all safe new
  });

  it("applies selected changes and renders the apply result", async () => {
    setup([conn1, conn2]);
    render(<SyncView />);
    fireEvent.click(screen.getByText("Card sync"));
    const previewButton = await screen.findByRole("button", { name: /run preview/i });
    await waitFor(() => expect(previewButton).toBeEnabled());
    fireEvent.click(previewButton);

    const applyButton = await screen.findByRole("button", { name: /apply selected changes/i });
    fireEvent.click(applyButton);

    expect(applyMutate).toHaveBeenCalledTimes(1);
    expect(applyMutate.mock.calls[0][0]).toMatchObject({ runId: "run-1", selection: { selectedItemIds: ["new-1"] } });
    expect(await screen.findByText(/Apply applied/i)).toBeInTheDocument();
  });

  it("renders run history for the selected flow", async () => {
    setup([conn1, conn2]);
    render(<SyncView />);
    fireEvent.click(screen.getByText("Card sync"));
    expect(await screen.findByText("Run history")).toBeInTheDocument();
    expect(screen.getAllByText(/draft preview/i).length).toBeGreaterThan(0);
  });
});
