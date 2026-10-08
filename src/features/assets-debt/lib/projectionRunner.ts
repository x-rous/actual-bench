import { projectDebt, type DebtProjection, type DebtProjectionInput } from "@/lib/financial-models/loan/projection";

/**
 * Where the simulator's projections run (P1.3b T203).
 *
 * The day-by-day engine takes hundreds of milliseconds for a 30-year loan
 * (plan.md, T199), so in the browser projections run in a Web Worker. The
 * latest request wins: a newer request terminates a worker still busy with an
 * older one, so a stale calculation never delays the current one. Where no
 * Worker exists (tests, server rendering) the same engine runs synchronously.
 */

export type ProjectionOutcome = { projection: DebtProjection; comparison: DebtProjection | null; impactBaseline: DebtProjection | null; durationMs: number };

export interface ProjectionRunner {
  run(primary: DebtProjectionInput, comparison: DebtProjectionInput | null, impactBaseline?: DebtProjectionInput | null): Promise<ProjectionOutcome>;
  dispose(): void;
}

export class SupersededError extends Error {
  constructor() {
    super("A newer calculation replaced this one");
    this.name = "SupersededError";
  }
}

export function createSyncRunner(): ProjectionRunner {
  return {
    async run(primary, comparison, impactBaseline = null) {
      const started = performance.now();
      return { projection: projectDebt(primary), comparison: comparison ? projectDebt(comparison) : null, impactBaseline: impactBaseline ? projectDebt(impactBaseline) : null, durationMs: performance.now() - started };
    },
    dispose() {},
  };
}

export function createWorkerRunner(spawn: () => Worker): ProjectionRunner {
  let worker: Worker | null = null;
  let pending: { id: number; resolve: (o: ProjectionOutcome) => void; reject: (e: Error) => void } | null = null;
  let nextId = 0;

  const attach = (w: Worker) => {
    w.onmessage = (event: MessageEvent<{ id: number; ok: boolean; projection?: DebtProjection; comparison?: DebtProjection | null; impactBaseline?: DebtProjection | null; durationMs?: number; error?: string }>) => {
      const data = event.data;
      if (!pending || data.id !== pending.id) return;
      const { resolve, reject } = pending;
      pending = null;
      if (data.ok) resolve({ projection: data.projection!, comparison: data.comparison ?? null, impactBaseline: data.impactBaseline ?? null, durationMs: data.durationMs ?? 0 });
      else reject(new Error(data.error ?? "The calculation failed"));
    };
    w.onerror = (event) => {
      if (!pending) return;
      const { reject } = pending;
      pending = null;
      reject(new Error(event.message || "The calculation worker failed"));
    };
  };

  return {
    run(primary, comparison, impactBaseline = null) {
      if (pending) {
        // Latest wins: stop the busy worker rather than wait for a result nobody needs.
        pending.reject(new SupersededError());
        pending = null;
        worker?.terminate();
        worker = null;
      }
      if (!worker) {
        worker = spawn();
        attach(worker);
      }
      const id = ++nextId;
      return new Promise<ProjectionOutcome>((resolve, reject) => {
        pending = { id, resolve, reject };
        worker!.postMessage({ id, primary, comparison, impactBaseline });
      });
    },
    dispose() {
      pending?.reject(new SupersededError());
      pending = null;
      worker?.terminate();
      worker = null;
    },
  };
}

export function createDefaultRunner(): ProjectionRunner {
  if (typeof Worker === "undefined") return createSyncRunner();
  return createWorkerRunner(() => new Worker(new URL("../workers/projection.worker.ts", import.meta.url), { type: "module" }));
}
