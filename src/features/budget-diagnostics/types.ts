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

export type LoadedSnapshotSummary = {
  dbSizeBytes: number;
  zipFilename: string | null;
  zipSizeBytes: number;
  hadMetadata: boolean;
  metadata: MetadataJson | null;
  tableCount: number;
  viewCount: number;
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
  runDiagnostics: never;
  runIntegrityCheck: never;
  listSchemaObjects: never;
  getSchemaObject: never;
  tableCounts: never;
  fetchRows: never;
};
