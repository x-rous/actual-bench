import { generateId } from "@/lib/uuid";
import type { ApiError } from "@/types/errors";
import type {
  ProgressStage,
  WorkerRequest,
  WorkerRequestInput,
  WorkerResponse,
  WorkerResultByKind,
} from "../types";

const REQUEST_TIMEOUT_MS = 60_000;

type PendingRequest<T> = {
  resolve: (payload: T) => void;
  reject: (error: ApiError) => void;
  onProgress?: (stage: ProgressStage) => void;
  timeout: ReturnType<typeof setTimeout> | null;
};

function toWorkerError(message: string, raw?: unknown): ApiError {
  return { kind: "api", status: 0, message, raw };
}

function createWorker(): Worker {
  return new Worker(new URL("../workers/sqliteDiagnostics.worker.ts", import.meta.url), {
    type: "module",
  });
}

export class SqliteWorkerClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, PendingRequest<unknown>>();

  call<K extends keyof WorkerResultByKind>(
    request: Extract<WorkerRequestInput, { kind: K }>,
    options: {
      onProgress?: (stage: ProgressStage) => void;
      transfer?: Transferable[];
      timeoutMs?: number | null;
    } = {}
  ): Promise<WorkerResultByKind[K]> {
    const worker = this.ensureWorker();
    const id = generateId();
    const message = { ...request, id } as WorkerRequest;

    return new Promise<WorkerResultByKind[K]>((resolve, reject) => {
      const timeoutMs = options.timeoutMs === undefined ? REQUEST_TIMEOUT_MS : options.timeoutMs;
      const timeout =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              this.pending.delete(id);
              reject(toWorkerError(`SQLite worker request timed out: ${request.kind}`));
            }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (payload: unknown) => void,
        reject,
        onProgress: options.onProgress,
        timeout,
      });

      try {
        worker.postMessage(message, options.transfer ?? []);
      } catch (error) {
        this.pending.delete(id);
        if (timeout) clearTimeout(timeout);
        reject(toWorkerError("SQLite worker request could not be sent", error));
      }
    });
  }

  destroy() {
    this.rejectAll("SQLite worker was stopped");
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = createWorker();
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleMessage(event.data);
    };
    worker.onerror = (event) => {
      this.rejectAll(event.message || "SQLite worker failed", event);
    };
    worker.onmessageerror = (event) => {
      this.rejectAll("SQLite worker sent an unreadable message", event);
    };
    this.worker = worker;
    return worker;
  }

  private handleMessage(response: WorkerResponse) {
    const pending = this.pending.get(response.id);
    if (!pending) return;

    if (response.kind === "progress") {
      pending.onProgress?.(response.stage);
      return;
    }

    this.pending.delete(response.id);
    if (pending.timeout) clearTimeout(pending.timeout);

    if (response.kind === "error") {
      pending.reject(toWorkerError(response.message));
      return;
    }

    pending.resolve(response.payload);
  }

  private rejectAll(message: string, raw?: unknown) {
    for (const pending of this.pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(toWorkerError(message, raw));
    }
    this.pending.clear();
  }
}

let singleton: SqliteWorkerClient | null = null;

export function getSqliteWorkerClient(): SqliteWorkerClient {
  singleton ??= new SqliteWorkerClient();
  return singleton;
}

export function resetSqliteWorkerClient() {
  singleton?.destroy();
  singleton = null;
}
