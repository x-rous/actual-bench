import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { SqliteWasmApi, SqliteWasmDb } from "@sqlite.org/sqlite-wasm";
import { unzipSnapshot } from "../lib/zipReader";
import type {
  LoadedSnapshotSummary,
  ProgressStage,
  WorkerRequest,
  WorkerResponse,
} from "../types";

let sqlite3: SqliteWasmApi | null = null;
let db: SqliteWasmDb | null = null;
let snapshotCounter = 0;

function post(response: WorkerResponse) {
  self.postMessage(response);
}

function progress(id: string, stage: ProgressStage) {
  post({ id, kind: "progress", stage });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown worker error";
}

async function initSqlite(wasmUrl: string): Promise<{ initialized: true }> {
  if (sqlite3) return { initialized: true };

  sqlite3 = await sqlite3InitModule({
    locateFile: (file) => (file.endsWith(".wasm") ? wasmUrl : file),
    print: () => undefined,
    printErr: () => undefined,
  });

  return { initialized: true };
}

function closeCurrentDb() {
  db?.close();
  db = null;
}

function countSchemaObjects(database: SqliteWasmDb, type: "table" | "view"): number {
  const value = database.selectValue(
    `SELECT COUNT(*) FROM sqlite_schema WHERE type = '${type}' AND name NOT LIKE 'sqlite_%'`
  );
  return typeof value === "number" ? value : Number(value ?? 0);
}

function loadSnapshot(id: string, zipBytes: ArrayBuffer): LoadedSnapshotSummary {
  if (!sqlite3) {
    throw new Error("SQLite worker has not been initialized");
  }

  progress(id, "unpacking");
  const snapshot = unzipSnapshot(zipBytes);

  progress(id, "opening");
  closeCurrentDb();

  const filename = `budget-diagnostics-${++snapshotCounter}.sqlite`;
  sqlite3.capi.sqlite3_js_vfs_create_file(
    null,
    filename,
    snapshot.dbBytes,
    snapshot.dbBytes.byteLength
  );
  db = new sqlite3.oo1.DB(filename, "r");

  const tableCount = countSchemaObjects(db, "table");
  const viewCount = countSchemaObjects(db, "view");

  progress(id, "ready");

  return {
    dbSizeBytes: snapshot.dbBytes.byteLength,
    hadMetadata: snapshot.hadMetadata,
    metadata: snapshot.metadata,
    tableCount,
    viewCount,
  };
}

function handleRequest(request: WorkerRequest): Promise<unknown> | unknown {
  switch (request.kind) {
    case "init":
      return initSqlite(request.wasmUrl);
    case "loadSnapshot":
      return loadSnapshot(request.id, request.zipBytes);
    case "overview":
    case "runDiagnostics":
    case "runIntegrityCheck":
    case "listSchemaObjects":
    case "getSchemaObject":
    case "tableCounts":
    case "fetchRows":
      throw new Error(`${request.kind} is not implemented until a later milestone`);
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  void Promise.resolve()
    .then(() => handleRequest(request))
    .then((payload) => {
      post({ id: request.id, kind: "result", payload });
    })
    .catch((error: unknown) => {
      post({ id: request.id, kind: "error", message: getErrorMessage(error) });
    });
});
