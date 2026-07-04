import { apiDownload, type DownloadResult } from "../../../lib/api/client";
import { exportBrowserApiBudgetZip } from "../../../lib/actual/browser/runtime";
import type { BrowserApiConnection, HttpApiConnection } from "@/store/connection";
import type { LoadedSnapshotSummary, WorkerRequestInput, WorkerResultByKind } from "../types";
import { exportSnapshot } from "./exportSnapshot";
import { getSqliteWorkerClient, type SqliteWorkerClient } from "./sqliteWorkerClient";

jest.mock("../../../lib/api/client", () => ({
  apiDownload: jest.fn(),
}));

jest.mock("../../../lib/actual/browser/runtime", () => ({
  exportBrowserApiBudgetZip: jest.fn(),
}));

jest.mock("./sqliteWorkerClient", () => ({
  getSqliteWorkerClient: jest.fn(),
}));

const mockApiDownload = apiDownload as jest.MockedFunction<typeof apiDownload>;
const mockExportBrowserApiBudgetZip = exportBrowserApiBudgetZip as jest.MockedFunction<
  typeof exportBrowserApiBudgetZip
>;
const mockGetSqliteWorkerClient = getSqliteWorkerClient as jest.MockedFunction<
  typeof getSqliteWorkerClient
>;

const httpConnection: HttpApiConnection = {
  id: "http-1",
  label: "HTTP Budget",
  mode: "http-api",
  baseUrl: "https://api.example.com",
  apiKey: "api-key",
  budgetSyncId: "budget-1",
};

const directConnection: BrowserApiConnection = {
  id: "direct-1",
  label: "Direct Household",
  mode: "browser-api",
  baseUrl: "https://actual.example.com",
  serverPassword: "server-password",
  budgetSyncId: "budget-1",
};

const summary: LoadedSnapshotSummary = {
  dbSizeBytes: 1024,
  zipFilename: "budget.zip",
  zipSizeBytes: 16,
  hadMetadata: true,
  metadata: { id: "budget-id", budgetName: "Household" },
  tableCount: 12,
  viewCount: 4,
};

function makeDownload(bytes: ArrayBuffer): DownloadResult {
  return {
    bytes,
    filename: "http-budget.zip",
    contentType: "application/zip",
  };
}

function makeWorkerClient() {
  const calls: Array<{
    request: WorkerRequestInput;
    options?: { onProgress?: unknown; transfer?: Transferable[] };
  }> = [];

  const client = {
    call: jest.fn(
      <K extends keyof WorkerResultByKind>(
        request: Extract<WorkerRequestInput, { kind: K }>,
        options?: { onProgress?: unknown; transfer?: Transferable[] }
      ): Promise<WorkerResultByKind[K]> => {
        calls.push({ request, options });
        if (request.kind === "loadSnapshot") {
          return Promise.resolve(summary as WorkerResultByKind[K]);
        }
        return Promise.resolve(undefined as unknown as WorkerResultByKind[K]);
      }
    ),
  } as unknown as SqliteWorkerClient;

  return { client, calls };
}

describe("exportSnapshot", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-04T12:00:00Z"));
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("downloads HTTP API snapshots through the proxy", async () => {
    const { client, calls } = makeWorkerClient();
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    mockGetSqliteWorkerClient.mockReturnValue(client);
    mockApiDownload.mockResolvedValue(makeDownload(bytes));

    const result = await exportSnapshot(httpConnection);

    expect(mockApiDownload).toHaveBeenCalledWith(httpConnection, "/export");
    expect(mockExportBrowserApiBudgetZip).not.toHaveBeenCalled();
    expect(result.download.filename).toBe("http-budget.zip");
    expect(result.summary).toBe(summary);
    expect(calls[0]?.request).toEqual({ kind: "init", wasmUrl: "/sqlite/sqlite3.wasm" });
    expect(calls[1]?.request).toMatchObject({
      kind: "loadSnapshot",
      zipFilename: "http-budget.zip",
      zipSizeBytes: 4,
    });
    expect(calls[1]?.options?.transfer).toHaveLength(1);
  });

  it("exports Direct snapshots from the Actual browser worker", async () => {
    const { client, calls } = makeWorkerClient();
    const bytes = new Uint8Array([5, 6, 7, 8]).buffer;
    mockGetSqliteWorkerClient.mockReturnValue(client);
    mockExportBrowserApiBudgetZip.mockResolvedValue(bytes);

    const result = await exportSnapshot(directConnection);

    expect(mockApiDownload).not.toHaveBeenCalled();
    expect(mockExportBrowserApiBudgetZip).toHaveBeenCalledWith(directConnection);
    expect(result.download).toMatchObject({
      filename: "direct-household-2026-07-04.zip",
      contentType: "application/zip",
    });
    expect(result.summary).toBe(summary);
    expect(calls[1]?.request).toMatchObject({
      kind: "loadSnapshot",
      zipFilename: "direct-household-2026-07-04.zip",
      zipSizeBytes: 4,
    });
    expect(calls[1]?.options?.transfer).toHaveLength(1);
  });
});
