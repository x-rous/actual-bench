import { apiDownload } from "../../../lib/api/client";
import type { DownloadResult } from "../../../lib/api/client";
import { exportBrowserApiBudgetZip } from "../../../lib/actual/browser/runtime";
import { isBrowserApiConnection, type ConnectionInstance } from "@/store/connection";
import type { ProgressStage, LoadedSnapshotSummary } from "../types";
import { getSqliteWorkerClient } from "./sqliteWorkerClient";

export type ExportedSnapshot = {
  download: DownloadResult;
  summary: LoadedSnapshotSummary;
};

function directExportFilename(connection: ConnectionInstance): string {
  const date = new Date().toISOString().slice(0, 10);
  const safeLabel = connection.label
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${safeLabel || "direct-budget"}-${date}.zip`;
}

async function downloadSnapshotZip(
  connection: ConnectionInstance
): Promise<DownloadResult> {
  if (!isBrowserApiConnection(connection)) {
    return apiDownload(connection, "/export");
  }

  return {
    bytes: await exportBrowserApiBudgetZip(connection),
    filename: directExportFilename(connection),
    contentType: "application/zip",
  };
}

export async function exportSnapshot(
  connection: ConnectionInstance,
  onProgress?: (stage: ProgressStage) => void
): Promise<ExportedSnapshot> {
  onProgress?.("exporting");
  const download = await downloadSnapshotZip(connection);
  const bytesForWorker = download.bytes.slice(0);
  const client = getSqliteWorkerClient();

  await client.call({ kind: "init", wasmUrl: "/sqlite/sqlite3.wasm" }, { onProgress });
  const summary = await client.call(
    {
      kind: "loadSnapshot",
      zipBytes: bytesForWorker,
      zipFilename: download.filename,
      zipSizeBytes: download.bytes.byteLength,
    },
    { onProgress, transfer: [bytesForWorker] }
  );

  return { download, summary };
}
