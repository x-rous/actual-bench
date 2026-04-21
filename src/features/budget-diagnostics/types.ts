export type ProgressStage =
  | "exporting"
  | "unpacking"
  | "opening"
  | "readingSchema"
  | "computingOverview"
  | "runningDiagnostics"
  | "ready";

export type SnapshotMetadata = Record<string, unknown>;

export type MetadataJson = {
  id?: string | null;
  budgetName?: string | null;
  cloudFileId?: string | null;
  groupId?: string | null;
  userId?: string | null;
  lastUploaded?: string | null;
  lastSyncedTimestamp?: string | null;
  lastScheduleRun?: string | null;
  encryptKeyId?: string | null;
  resetClock?: boolean | null;
};

export type OverviewCountKey =
  | "transactions"
  | "accounts"
  | "payees"
  | "category_groups"
  | "categories"
  | "rules"
  | "schedules"
  | "tags"
  | "notes";

export type OverviewPayload = {
  metadata: MetadataJson | null;
  file: {
    dbSizeBytes: number;
    zipFilename: string | null;
    zipSizeBytes: number;
    hadMetadata: boolean;
    opened: boolean;
    zipValid: boolean;
  };
  counts: { tables: number; views: number } & Record<OverviewCountKey, number>;
};

export type DiagnosticSeverity = "error" | "warning" | "info";

export type BudgetDiagnostic = {
  code: string;
  severity: DiagnosticSeverity;
  title: string;
  message: string;
  details?: string[];
  table?: string;
  rowId?: string;
  relatedTable?: string;
  relatedId?: string;
};

export type DiagnosticsPayload = {
  findings: BudgetDiagnostic[];
};

export type LoadedSnapshotSummary = {
  dbSizeBytes: number;
  zipFilename: string | null;
  zipSizeBytes: number;
  hadMetadata: boolean;
  metadata: MetadataJson | null;
  tableCount: number;
  viewCount: number;
};

export type SchemaObjectType = "table" | "view" | "index" | "trigger";

export type SchemaObjectGroup =
  | "featuredViews"
  | "coreTables"
  | "mappingTables"
  | "budgetTables"
  | "systemMetadata"
  | "reportingDashboard"
  | "other";

export type ColumnInfo = {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: unknown;
  primaryKeyPosition: number;
};

export type IndexInfo = {
  name: string;
  unique: boolean;
  origin: string | null;
  partial: boolean;
};

export type RowKeyInfo = {
  column: string;
  source: "primaryKey" | "knownKey" | "rowid";
};

export type SchemaObjectSummary = {
  name: string;
  type: SchemaObjectType;
  rowCount: number | null;
  featured: boolean;
  group: SchemaObjectGroup;
};

export type SchemaObjectDetails = {
  name: string;
  type: SchemaObjectType;
  tableName: string | null;
  sql: string | null;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  rowCount: number | null;
  rowKey: RowKeyInfo | null;
};

export type SchemaObjectsPayload = {
  objects: SchemaObjectSummary[];
};

export type TableCountsPayload = {
  counts: Record<string, number | null>;
};

export type FetchRowsPayload = {
  object: string;
  columns: string[];
  rows: Record<string, unknown>[];
  offset: number;
  limit: number;
  rowCount: number;
};

export type WorkerRequest =
  | { id: string; kind: "init"; wasmUrl: string }
  | {
      id: string;
      kind: "loadSnapshot";
      zipBytes: ArrayBuffer;
      zipFilename?: string | null;
      zipSizeBytes?: number;
    }
  | { id: string; kind: "overview" }
  | { id: string; kind: "runDiagnostics" }
  | { id: string; kind: "runIntegrityCheck" }
  | { id: string; kind: "listSchemaObjects" }
  | { id: string; kind: "getSchemaObject"; name: string }
  | { id: string; kind: "tableCounts"; names: string[] }
  | {
      id: string;
      kind: "fetchRows";
      object: string;
      offset: number;
      limit: number;
      orderBy?: string;
      direction?: "asc" | "desc";
    };

type WithoutRequestId<T> = T extends { id: string } ? Omit<T, "id"> : never;

export type WorkerRequestInput = WithoutRequestId<WorkerRequest>;

export type WorkerResponse =
  | { id: string; kind: "progress"; stage: ProgressStage }
  | { id: string; kind: "result"; payload: unknown }
  | { id: string; kind: "error"; message: string };

export type WorkerResultByKind = {
  init: { initialized: true };
  loadSnapshot: LoadedSnapshotSummary;
  overview: OverviewPayload;
  runDiagnostics: DiagnosticsPayload;
  runIntegrityCheck: DiagnosticsPayload;
  listSchemaObjects: SchemaObjectsPayload;
  getSchemaObject: SchemaObjectDetails;
  tableCounts: TableCountsPayload;
  fetchRows: FetchRowsPayload;
};
