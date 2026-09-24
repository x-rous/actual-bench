import { EventEmitter } from "node:events";
import { createTaskHost } from "../taskHost";
import { WORKER_PROTOCOL_VERSION } from "../protocol";
import type { SpawnWorker, SupervisedWorker } from "../supervisor";

/**
 * Test doubles for worker threads (RD-095).
 *
 * Jest cannot start a real worker on the TypeScript entry, so these stand in.
 * `hostBackedSpawn` is the important one: a fake thread that runs the *real*
 * task host - the same code a worker runs - and talks to the supervisor
 * through the real protocol, with every message structured-cloned both ways as
 * a thread boundary would. Everything that crosses is recorded, so a test can
 * assert what did and did not leave.
 */

export class FakeWorker extends EventEmitter implements SupervisedWorker {
  readonly posted: unknown[] = [];
  terminated = false;
  onParentMessage: ((message: unknown) => void) | null = null;

  postMessage(message: unknown): void {
    const copy = structuredClone(message);
    this.posted.push(copy);
    this.onParentMessage?.(copy);
  }

  /** Deliver a message to the supervisor, as the worker thread would. */
  send(message: unknown): void {
    const copy = structuredClone(message);
    setImmediate(() => {
      if (!this.terminated) this.emit("message", copy);
    });
  }

  terminate(): Promise<number> {
    if (!this.terminated) {
      this.terminated = true;
      setImmediate(() => this.emit("exit", 1));
    }
    return Promise.resolve(1);
  }
}

export type CrossingLog = { toWorker: unknown[]; toParent: unknown[] };

/** A spawn whose workers run the real task host in this thread. */
export function hostBackedSpawn(crossings: CrossingLog = { toWorker: [], toParent: [] }): {
  spawn: SpawnWorker;
  crossings: CrossingLog;
  workers: FakeWorker[];
} {
  const workers: FakeWorker[] = [];
  const spawn: SpawnWorker = () => {
    const worker = new FakeWorker();
    workers.push(worker);
    const host = createTaskHost((message) => {
      crossings.toParent.push(structuredClone(message));
      worker.send(message);
    });
    worker.onParentMessage = (message) => {
      crossings.toWorker.push(message);
      void host.handle(message);
    };
    worker.send({ type: "ready", protocol: WORKER_PROTOCOL_VERSION, nodeVersion: process.version, heapLimitMb: 512 });
    return worker;
  };
  return { spawn, crossings, workers };
}

/** A spawn whose workers answer `ready` and then do whatever `script` says with each task. */
export function scriptedSpawn(
  script: (worker: FakeWorker, task: { taskId: string; kind: string; input: unknown }) => void,
  options: { ready?: boolean } = {}
): { spawn: SpawnWorker; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const spawn: SpawnWorker = () => {
    const worker = new FakeWorker();
    workers.push(worker);
    worker.onParentMessage = (message) => {
      const task = message as { type?: string; taskId: string; kind: string; input: unknown };
      if (task.type === "task") script(worker, task);
    };
    if (options.ready !== false) {
      worker.send({ type: "ready", protocol: WORKER_PROTOCOL_VERSION, nodeVersion: process.version, heapLimitMb: 512 });
    }
    return worker;
  };
  return { spawn, workers };
}
