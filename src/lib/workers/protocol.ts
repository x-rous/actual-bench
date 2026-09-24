import { z } from "zod";

/**
 * The messages that cross between the server and a worker thread (RD-095).
 *
 * Validated on both sides, not merely typed: a worker is a separate module
 * graph, and after an upgrade it could be running a different build than the
 * thread talking to it. Everything is plain JSON. **Secrets never cross:** a
 * task carries references, and the worker opens any secret it needs itself.
 */

export const WORKER_PROTOCOL_VERSION = 1;

const phase = z.enum(["reading", "mutating", "external"]);

export const parentToWorkerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task"), taskId: z.string().min(1), kind: z.string().min(1), input: z.unknown() }),
  z.object({ type: z.literal("cancel"), taskId: z.string().min(1) }),
]);

export const workerToParentMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    protocol: z.number().int(),
    nodeVersion: z.string(),
    heapLimitMb: z.number(),
  }),
  z.object({ type: z.literal("phase"), taskId: z.string(), phase }),
  z.object({ type: z.literal("result"), taskId: z.string(), output: z.unknown() }),
  /** The task could not run at all (bad input, unknown kind). Already redacted. */
  z.object({ type: z.literal("error"), taskId: z.string(), message: z.string() }),
]);

export type ParentToWorkerMessage = z.infer<typeof parentToWorkerMessage>;
export type WorkerToParentMessage = z.infer<typeof workerToParentMessage>;
