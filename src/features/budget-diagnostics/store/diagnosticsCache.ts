import { create } from "zustand";
import type { DownloadResult } from "@/lib/api/client";
import {
  isBrowserApiConnection,
  isHttpApiConnection,
  type ConnectionInstance,
} from "@/store/connection";
import type { DiagnosticsPayload, OverviewPayload, ProgressStage } from "../types";

/**
 * Persistent cache for the Budget Diagnostics snapshot.
 *
 * The snapshot (downloaded budget export → unzipped → loaded into the sqlite
 * worker) is expensive to build, so we keep it in a module-level store rather
 * than component state. That lets the user navigate away and back — or open the
 * standalone Data Browser — without re-downloading. The actual sqlite DB lives
 * in the worker singleton (see sqliteWorkerClient); this store holds the React
 * view-model plus the metadata needed to decide whether the cache is still valid.
 *
 * Invalidation is manual: an explicit Reload, a connection change, or disconnect
 * (the `signature` captures the connection identity + credentials).
 */
export type SnapshotState = {
  status: "idle" | "loading" | "ready" | "error";
  diagnosticsStatus: "idle" | "loading" | "ready" | "error";
  integrityStatus: "idle" | "loading" | "error";
  progressStage: ProgressStage | null;
  errorMessage: string | null;
  diagnosticsError: string | null;
  integrityError: string | null;
  overview: OverviewPayload | null;
  diagnostics: DiagnosticsPayload | null;
  download: DownloadResult | null;
};

export const INITIAL_SNAPSHOT_STATE: SnapshotState = {
  status: "idle",
  diagnosticsStatus: "idle",
  integrityStatus: "idle",
  progressStage: null,
  errorMessage: null,
  diagnosticsError: null,
  integrityError: null,
  overview: null,
  diagnostics: null,
  download: null,
};

/** Identity of the connection (incl. credentials) a cached snapshot belongs to. */
export function connectionSignature(connection: ConnectionInstance): string {
  return [
    connection.id,
    connection.mode,
    connection.baseUrl,
    connection.budgetSyncId ?? "",
    isHttpApiConnection(connection) ? connection.apiKey : "",
    isBrowserApiConnection(connection) ? connection.serverPassword : "",
    connection.encryptionPassword ?? "",
  ].join("|");
}

type SnapshotUpdater = SnapshotState | ((current: SnapshotState) => SnapshotState);

type DiagnosticsCacheState = {
  /** Connection-identity signature the cached snapshot was built for. */
  signature: string | null;
  /** Connection id (for matching the worker's loaded DB). */
  connectionId: string | null;
  /** Epoch ms when the snapshot's initial export completed ("loaded X ago"). */
  loadedAt: number | null;
  snapshot: SnapshotState;
  setSnapshot: (updater: SnapshotUpdater) => void;
  /** Mark the cache as freshly loaded for a connection. */
  commitLoaded: (connectionId: string, signature: string, loadedAt?: number) => void;
  /** Clear everything (reload / disconnect / connection change). */
  reset: () => void;
};

export const useDiagnosticsCacheStore = create<DiagnosticsCacheState>((set) => ({
  signature: null,
  connectionId: null,
  loadedAt: null,
  snapshot: INITIAL_SNAPSHOT_STATE,
  setSnapshot: (updater) =>
    set((s) => ({
      snapshot:
        typeof updater === "function"
          ? (updater as (current: SnapshotState) => SnapshotState)(s.snapshot)
          : updater,
    })),
  commitLoaded: (connectionId, signature, loadedAt = Date.now()) =>
    set({ connectionId, signature, loadedAt }),
  reset: () =>
    set({
      signature: null,
      connectionId: null,
      loadedAt: null,
      snapshot: INITIAL_SNAPSHOT_STATE,
    }),
}));
