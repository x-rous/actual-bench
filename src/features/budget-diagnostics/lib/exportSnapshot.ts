import { apiDownload } from "@/lib/api/client";
import type { DownloadResult } from "@/lib/api/client";
import type { ConnectionInstance } from "@/store/connection";
import type { ProgressStage, LoadedSnapshotSummary } from "../types";
import { getSqliteWorkerClient } from "./sqliteWorkerClient";

export type ExportedSnapshot = {
  download: DownloadResult;
  summary: LoadedSnapshotSummary;
};

export async function exportSnapshot(
  connection: ConnectionInstance,
  onProgress?: (stage: ProgressStage) => void
): Promise<ExportedSnapshot> {
  onProgress?.("exporting");
  const download = await apiDownload(connection, "/export");
  const bytesForWorker = download.bytes.slice(0);
  const client = getSqliteWorkerClient();

  await client.call({ kind: "init", wasmUrl: "/sqlite/sqlite3.wasm" }, { onProgress });
  const summary = await client.call(
    { kind: "loadSnapshot", zipBytes: bytesForWorker },
    { onProgress, transfer: [bytesForWorker] }
  );

  return { download, summary };
}
