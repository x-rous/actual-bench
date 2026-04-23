import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  resetSqliteWorkerClient,
  type SqliteWorkerClient,
} from "../lib/sqliteWorkerClient";

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
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

const download: DownloadResult = {
  bytes: new ArrayBuffer(8),
  filename: "household.zip",
  contentType: "application/zip",
};

const summary: LoadedSnapshotSummary = {
  dbSizeBytes: 1024,
  zipFilename: "household.zip",
  zipSizeBytes: 2048,
  hadMetadata: true,
  metadata: { budgetName: "Household" },
  tableCount: 12,
  viewCount: 4,
};

const overview: OverviewPayload = {
  metadata: { budgetName: "Household" },
  file: {
    dbSizeBytes: 1024,
    zipFilename: "household.zip",
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

  it("opens the active budget snapshot and renders the tabbed diagnostics workspace", async () => {
    render(<BudgetDiagnosticsView />);

    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Data Browser" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Snapshot counts")).toBeInTheDocument();
    });

    expect(screen.getByRole("tab", { name: /Diagnostics 1/ })).toBeInTheDocument();
    expect(screen.getByText("Read-only. No changes written back to the budget. Exports are processed locally.")).toBeInTheDocument();
    expect(screen.getByText("Export contents are processed locally and may include personal budget data.")).toBeInTheDocument();
    expect(screen.getByText("Transactions")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(mockExportSnapshot).toHaveBeenCalledWith(connection, expect.any(Function));
  });

  it("shows the progress rail error state and retries opening the snapshot", async () => {
    mockExportSnapshot
      .mockRejectedValueOnce(new Error("Export failed"))
      .mockResolvedValueOnce({ download, summary });

    render(<BudgetDiagnosticsView />);

    expect(await screen.findByText("Snapshot export failed")).toBeInTheDocument();
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
    expect(mockResetSqliteWorkerClient).toHaveBeenCalled();
  });
});
