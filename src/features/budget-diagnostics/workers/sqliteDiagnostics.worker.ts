import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { SqliteWasmApi, SqliteWasmDb } from "@sqlite.org/sqlite-wasm";
import {
  runDiagnosticChecks,
  runIntegrityCheck,
  type DiagnosticDb,
} from "../lib/diagnosticChecks";
import {
  fetchRows,
  getSchemaObject,
  listSchemaObjects,
  lookupRow,
  tableCounts,
  type SchemaDb,
} from "../lib/schemaObjects";
import { unzipSnapshot } from "../lib/zipReader";
import type {
  DiagnosticsPayload,
  LoadedSnapshotSummary,
  MetadataJson,
  OverviewCountKey,
  OverviewPayload,
  ProgressStage,
  WorkerRequest,
  WorkerResponse,
} from "../types";

let sqlite3: SqliteWasmApi | null = null;
let db: SqliteWasmDb | null = null;
let snapshotCounter = 0;
let currentSnapshot: {
  dbSizeBytes: number;
  zipFilename: string | null;
  zipSizeBytes: number;
  hadMetadata: boolean;
  metadata: MetadataJson | null;
  zipValid: boolean;
  opened: boolean;
} | null = null;

const OVERVIEW_TABLES: readonly OverviewCountKey[] = [
  "transactions",
  "accounts",
  "payees",
  "category_groups",
  "categories",
  "rules",
  "schedules",
  "tags",
  "notes",
];

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
  currentSnapshot = null;
}

function countSchemaObjects(database: SqliteWasmDb, type: "table" | "view"): number {
  const value = database.selectValue(
    `SELECT COUNT(*) FROM sqlite_schema WHERE type = '${type}' AND name NOT LIKE 'sqlite_%'`
  );
  return typeof value === "number" ? value : Number(value ?? 0);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function countRows(database: SqliteWasmDb, table: OverviewCountKey): number {
  try {
    const value = database.selectValue(`SELECT COUNT(*) FROM ${quoteIdentifier(table)}`);
    return typeof value === "number" ? value : Number(value ?? 0);
  } catch {
    return 0;
  }
}

function buildOverview(): OverviewPayload {
  if (!db || !currentSnapshot?.opened) {
    throw new Error("No budget snapshot is loaded");
  }

  const counts = {
    tables: countSchemaObjects(db, "table"),
    views: countSchemaObjects(db, "view"),
    transactions: 0,
    accounts: 0,
    payees: 0,
    category_groups: 0,
    categories: 0,
    rules: 0,
    schedules: 0,
    tags: 0,
    notes: 0,
  } satisfies OverviewPayload["counts"];

  for (const table of OVERVIEW_TABLES) {
    counts[table] = countRows(db, table);
  }

  return {
    metadata: currentSnapshot.metadata,
    file: {
      dbSizeBytes: currentSnapshot.dbSizeBytes,
      zipFilename: currentSnapshot.zipFilename,
      zipSizeBytes: currentSnapshot.zipSizeBytes,
      hadMetadata: currentSnapshot.hadMetadata,
      opened: currentSnapshot.opened,
      zipValid: currentSnapshot.zipValid,
    },
    counts,
  };
}

function requireDb(): SqliteWasmDb {
  if (!db || !currentSnapshot?.opened) {
    throw new Error("No budget snapshot is loaded");
  }
  return db;
}

function selectRows<T extends Record<string, unknown>>(
  database: SqliteWasmDb,
  sql: string
): T[] {
  const resultRows: unknown[] = [];
  database.exec({ sql, rowMode: "object", resultRows });
  return resultRows as T[];
}

function createDiagnosticDb(database: SqliteWasmDb): DiagnosticDb {
  return {
    exec: (sql) => {
      database.exec(sql);
    },
    selectValue: (sql) => database.selectValue(sql),
    selectRows: (sql) => selectRows(database, sql),
    objectExists: (name, type) => {
      const typeClause = type ? ` AND type = ${sqlLiteral(type)}` : "";
      const value = database.selectValue(
        `SELECT COUNT(*) FROM sqlite_schema WHERE name = ${sqlLiteral(name)}${typeClause}`
      );
      return Number(value ?? 0) > 0;
    },
    getColumns: (name) => {
      const rows = selectRows<{ name: string }>(
        database,
        `PRAGMA table_info(${quoteIdentifier(name)})`
      );
      return rows.map((row) => String(row.name));
    },
  };
}

function createSchemaDb(database: SqliteWasmDb): SchemaDb {
  return {
    selectValue: (sql) => database.selectValue(sql),
    selectRows: (sql) => selectRows(database, sql),
  };
}

function runWorkerDiagnostics(id: string): DiagnosticsPayload {
  progress(id, "runningDiagnostics");
  const database = requireDb();
  return {
    findings: runDiagnosticChecks(createDiagnosticDb(database), currentSnapshot?.metadata ?? null),
  };
}

function runWorkerIntegrityCheck(id: string): DiagnosticsPayload {
  progress(id, "runningDiagnostics");
  const database = requireDb();
  const heartbeat = self.setInterval(() => {
    progress(id, "runningDiagnostics");
  }, 5000);

  try {
    return {
      findings: runIntegrityCheck(createDiagnosticDb(database)),
    };
  } finally {
    self.clearInterval(heartbeat);
  }
}

function loadSnapshot(request: Extract<WorkerRequest, { kind: "loadSnapshot" }>): LoadedSnapshotSummary {
  const { id, zipBytes, zipFilename = null, zipSizeBytes = zipBytes.byteLength } = request;

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
  currentSnapshot = {
    dbSizeBytes: snapshot.dbBytes.byteLength,
    zipFilename,
    zipSizeBytes,
    hadMetadata: snapshot.hadMetadata,
    metadata: snapshot.metadata,
    zipValid: true,
    opened: true,
  };

  progress(id, "ready");

  return {
    dbSizeBytes: snapshot.dbBytes.byteLength,
    zipFilename,
    zipSizeBytes,
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
      return loadSnapshot(request);
    case "overview":
      progress(request.id, "computingOverview");
      return buildOverview();
    case "runDiagnostics":
      return runWorkerDiagnostics(request.id);
    case "runIntegrityCheck":
      return runWorkerIntegrityCheck(request.id);
    case "listSchemaObjects":
      return { objects: listSchemaObjects(createSchemaDb(requireDb())) };
    case "getSchemaObject":
      return getSchemaObject(createSchemaDb(requireDb()), request.name);
    case "tableCounts":
      return tableCounts(createSchemaDb(requireDb()), request.names);
    case "fetchRows":
      return fetchRows(createSchemaDb(requireDb()), request);
    case "lookupRow":
      return lookupRow(createSchemaDb(requireDb()), request);
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
