import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { useConnectionStore, type ConnectionInstance } from "@/store/connection";
import type { DownloadResult } from "@/lib/api/client";
import type {
  DiagnosticsPayload,
  LoadedSnapshotSummary,
  OverviewPayload,
  WorkerRequestInput,
  WorkerResultByKind,
} from "../types";
import { BudgetDiagnosticsView } from "./BudgetDiagnosticsView";
import { exportSnapshot } from "../lib/exportSnapshot";
import {
  getSqliteWorkerClient,
  isSqliteWorkerLoadedFor,
  resetSqliteWorkerClient,
  type SqliteWorkerClient,
} from "../lib/sqliteWorkerClient";
import { useDiagnosticsCacheStore } from "../store/diagnosticsCache";

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/budget-diagnostics",
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("../lib/exportSnapshot", () => ({
  exportSnapshot: jest.fn(),
}));

jest.mock("../lib/sqliteWorkerClient", () => ({
  getSqliteWorkerClient: jest.fn(),
  resetSqliteWorkerClient: jest.fn(),
  markSqliteWorkerLoaded: jest.fn(),
  isSqliteWorkerLoadedFor: jest.fn(() => false),
}));

const mockExportSnapshot = exportSnapshot as jest.MockedFunction<typeof exportSnapshot>;
const mockGetSqliteWorkerClient = getSqliteWorkerClient as jest.MockedFunction<
  typeof getSqliteWorkerClient
>;
const mockResetSqliteWorkerClient = resetSqliteWorkerClient as jest.MockedFunction<
  typeof resetSqliteWorkerClient
>;

const connection: ConnectionInstance = {
  id: "conn-1",
  label: "Household Budget",
  mode: "http-api",
  baseUrl: "http://localhost:5006",
  apiKey: "key",
  budgetSyncId: "budget-1",
};

const secondConnection: ConnectionInstance = {
  ...connection,
  id: "conn-2",
  label: "Business Budget",
  budgetSyncId: "budget-2",
};

const directConnection: ConnectionInstance = {
  id: "direct-1",
  label: "Direct Household",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  serverPassword: "secret",
  budgetSyncId: "budget-1",
};

const download: DownloadResult = {
  bytes: new ArrayBuffer(8),
  filename: "household.zip",
  contentType: "application/zip",
};

const summary: LoadedSnapshotSummary = {
  dbSizeBytes: 1024,
  zipFilename: "2026-04-23-Actual%20Bench%20Test.zip",
  zipSizeBytes: 2048,
  hadMetadata: true,
  metadata: {
    id: "budget-id",
    budgetName: "Household",
    cloudFileId: "cloud-id",
    groupId: "sync-id",
    userId: "user-id",
    encryptKeyId: "encryption-key-id",
  },
  tableCount: 12,
  viewCount: 4,
};

const overview: OverviewPayload = {
  metadata: {
    id: "budget-id",
    budgetName: "Household",
    cloudFileId: "cloud-id",
    groupId: "sync-id",
    userId: "user-id",
    encryptKeyId: "encryption-key-id",
  },
  file: {
    dbSizeBytes: 1024,
    zipFilename: "2026-04-23-Actual%20Bench%20Test.zip",
    zipSizeBytes: 2048,
    hadMetadata: true,
    opened: true,
    zipValid: true,
  },
  counts: {
    tables: 12,
    views: 4,
    transactions: 42,
    accounts: 3,
    payees: 9,
    category_groups: 2,
    categories: 11,
    rules: 5,
    schedules: 1,
    tags: 0,
    notes: 7,
  },
};

const diagnostics: DiagnosticsPayload = {
  findings: [
    {
      code: "REL_TEST",
      severity: "warning",
      title: "Missing relationship",
      message: "One linked row is missing.",
    },
    {
      code: "INFO_TEST",
      severity: "info",
      title: "Informational",
      message: "For context.",
    },
  ],
};

type MockWorkerClient = Pick<SqliteWorkerClient, "call">;

function createWorkerClient(): MockWorkerClient {
  return {
    call: jest.fn(
      <K extends keyof WorkerResultByKind>(
        request: Extract<WorkerRequestInput, { kind: K }>
      ): Promise<WorkerResultByKind[K]> => {
        switch (request.kind) {
          case "overview":
            return Promise.resolve(overview as WorkerResultByKind[K]);
          case "runDiagnostics":
            return Promise.resolve(diagnostics as WorkerResultByKind[K]);
          case "listSchemaObjects":
            return Promise.resolve({ objects: [] } as unknown as WorkerResultByKind[K]);
          default:
            return Promise.reject(new Error(`Unhandled worker request: ${request.kind}`));
        }
      }
    ),
  };
}

function setActiveConnection(instance: ConnectionInstance) {
  act(() => {
    useConnectionStore.setState({
      instances: [instance],
      activeInstanceId: instance.id,
    });
  });
}

describe("BudgetDiagnosticsView", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockReplace.mockReset();
    mockResetSqliteWorkerClient.mockReset();
    // The snapshot cache is module-level (survives navigation by design), so
    // clear it between tests to keep them isolated.
    useDiagnosticsCacheStore.getState().reset();
    (isSqliteWorkerLoadedFor as jest.Mock).mockReturnValue(false);
    mockGetSqliteWorkerClient.mockReturnValue(createWorkerClient() as SqliteWorkerClient);
    mockExportSnapshot.mockImplementation(async (_connection, onProgress) => {
      onProgress?.("exporting");
      onProgress?.("unpacking");
      onProgress?.("opening");
      onProgress?.("readingSchema");
      return { download, summary };
    });
    setActiveConnection(connection);
  });

  afterEach(() => {
    sessionStorage.clear();
    act(() => {
      useConnectionStore.setState({ instances: [], activeInstanceId: null });
    });
    jest.clearAllMocks();
  });

  it("gates Direct connections before exporting a snapshot", () => {
    setActiveConnection(directConnection);

    render(<BudgetDiagnosticsView />);

    expect(screen.getByText("Budget File Health needs HTTP API Server mode")).toBeInTheDocument();
    expect(mockExportSnapshot).not.toHaveBeenCalled();
  });

  it("opens the active budget snapshot and renders the tabbed diagnostics workspace", async () => {
    render(<BudgetDiagnosticsView />);

    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    // Data Browser is now its own top-level page, not a tab here.
    expect(screen.queryByRole("tab", { name: "Data Browser" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Snapshot counts")).toBeInTheDocument();
    });

    expect(screen.getByRole("tab", { name: /Diagnostics 1/ })).toBeInTheDocument();
    expect(screen.getByText("Read-only. No changes written back to the budget. Exports are processed locally.")).toBeInTheDocument();
    expect(screen.getByText("Transactions")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Budget ID")).toBeInTheDocument();
    expect(screen.getByText("Cloud file ID")).toBeInTheDocument();
    expect(screen.getByText("Group ID (sync ID)")).toBeInTheDocument();
    expect(screen.getByText("User ID")).toBeInTheDocument();
    expect(screen.getByText("Encryption key ID")).toBeInTheDocument();
    expect(screen.getByText("2026-04-23-Actual Bench Test.zip")).toBeInTheDocument();
    expect(mockExportSnapshot).toHaveBeenCalledWith(connection, expect.any(Function));
  });

  it("shows the progress rail error state and retries opening the snapshot", async () => {
    mockExportSnapshot
      .mockRejectedValueOnce(new Error("Export failed"))
      .mockResolvedValueOnce({ download, summary });

    render(<BudgetDiagnosticsView />);

    expect(await screen.findByText("Failed to open snapshot")).toBeInTheDocument();
    expect(screen.getByText("Export failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByText("Snapshot counts")).toBeInTheDocument();
    });
    expect(mockExportSnapshot).toHaveBeenCalledTimes(2);
  });

  it("resets the SQLite worker and reopens when the active budget changes", async () => {
    const { rerender } = render(<BudgetDiagnosticsView />);

    await waitFor(() => {
      expect(mockExportSnapshot).toHaveBeenCalledWith(connection, expect.any(Function));
    });

    const resetCountBeforeSwitch = mockResetSqliteWorkerClient.mock.calls.length;
    act(() => {
      useConnectionStore.setState({
        instances: [connection, secondConnection],
        activeInstanceId: secondConnection.id,
      });
    });
    rerender(<BudgetDiagnosticsView />);

    await waitFor(() => {
      expect(mockExportSnapshot).toHaveBeenCalledWith(secondConnection, expect.any(Function));
    });
    expect(mockResetSqliteWorkerClient.mock.calls.length).toBeGreaterThan(
      resetCountBeforeSwitch
    );
  });

  it("reuses the cached snapshot on remount without re-downloading", async () => {
    const { unmount } = render(<BudgetDiagnosticsView />);
    await waitFor(() => {
      expect(screen.getByText("Snapshot counts")).toBeInTheDocument();
    });
    expect(mockExportSnapshot).toHaveBeenCalledTimes(1);

    // Simulate navigating away and back, with the worker still holding the DB.
    unmount();
    (isSqliteWorkerLoadedFor as jest.Mock).mockReturnValue(true);
    render(<BudgetDiagnosticsView />);

    // The ready snapshot renders immediately and no second export is triggered.
    expect(screen.getByText("Snapshot counts")).toBeInTheDocument();
    expect(mockExportSnapshot).toHaveBeenCalledTimes(1);
  });

  it("re-exports (does not reuse) when a prior load was interrupted mid-diagnostics", async () => {
    // Worker whose runDiagnostics never resolves — simulates navigating away
    // while diagnostics is still running.
    mockGetSqliteWorkerClient.mockReturnValue({
      call: jest.fn((request: WorkerRequestInput) => {
        if (request.kind === "overview") return Promise.resolve(overview);
        if (request.kind === "runDiagnostics") return new Promise(() => {}); // hangs
        return Promise.resolve({ objects: [] });
      }),
    } as unknown as SqliteWorkerClient);

    const { unmount } = render(<BudgetDiagnosticsView />);
    // Overview is ready but diagnostics is still loading (never resolves).
    await waitFor(() => {
      expect(screen.getByText("Snapshot counts")).toBeInTheDocument();
    });
    expect(mockExportSnapshot).toHaveBeenCalledTimes(1);

    // Navigate away mid-diagnostics, then back with the worker still "loaded".
    unmount();
    (isSqliteWorkerLoadedFor as jest.Mock).mockReturnValue(true);
    render(<BudgetDiagnosticsView />);

    // The interrupted snapshot was never committed, so it must re-export rather
    // than reuse a snapshot stuck on diagnosticsStatus: "loading".
    await waitFor(() => {
      expect(mockExportSnapshot).toHaveBeenCalledTimes(2);
    });
  });
});
