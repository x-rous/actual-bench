import { parentPort } from "node:worker_threads";
import { getHeapStatistics } from "node:v8";
import { closeAppDb } from "@/lib/app-db/connection";
import { WORKER_PROTOCOL_VERSION, type WorkerToParentMessage } from "./protocol";
import { createTaskHost } from "./taskHost";

/**
 * The worker thread's entry (RD-095). Deliberately thin: everything it does is
 * in `taskHost`, which tests run in-thread.
 *
 * Lifetime policy `run`: announce itself, run the one task it is sent, and be
 * ended by the supervisor once it has answered. It does not exit on its own -
 * a message posted just before `process.exit()` can be lost - so it closes its
 * database connection *before* posting the answer, and the parent terminates
 * the thread on receipt.
 */

if (!parentPort) {
  throw new Error("bench.worker must run as a worker thread");
}
const port = parentPort;

const post = (message: WorkerToParentMessage): void => {
  if (message.type === "result" || message.type === "error") closeAppDb();
  port.postMessage(message);
};

const host = createTaskHost(post);
port.on("message", (raw: unknown) => {
  void host.handle(raw);
});

post({
  type: "ready",
  protocol: WORKER_PROTOCOL_VERSION,
  nodeVersion: process.version,
  heapLimitMb: Math.round(getHeapStatistics().heap_size_limit / (1024 * 1024)),
});
