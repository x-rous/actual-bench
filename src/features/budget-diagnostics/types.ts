export type ProgressStage =
  | "exporting"
  | "unpacking"
  | "opening"
  | "readingSchema"
  | "computingOverview"
  | "runningDiagnostics"
  | "ready";

export type SnapshotMetadata = Record<string, unknown>;

export type LoadedSnapshotSummary = {
  dbSizeBytes: number;
  hadMetadata: boolean;
  metadata: SnapshotMetadata | null;
  tableCount: number;
  viewCount: number;
};

export type WorkerRequest =
  | { id: string; kind: "init"; wasmUrl: string }
  | { id: string; kind: "loadSnapshot"; zipBytes: ArrayBuffer }
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
  overview: never;
  runDiagnostics: never;
  runIntegrityCheck: never;
  listSchemaObjects: never;
  getSchemaObject: never;
  tableCounts: never;
  fetchRows: never;
};
