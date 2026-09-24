import { Worker } from "node:worker_threads";

/**
 * Start one worker thread running `bench.worker.ts` (RD-095).
 *
 * The only place that names the worker file. Turbopack recognises exactly this
 * `new Worker(new URL(..., import.meta.url))` form and compiles the worker -
 * with its `@/` imports resolved - into a chunk of its own, in development and
 * in the standalone build alike. Jest cannot parse `import.meta`, so tests map
 * this module to a stub (`jest.config.cjs`) and give the supervisor a fake.
 *
 * `stdout`/`stderr` are captured rather than inherited so the supervisor can
 * redact what a worker prints before it reaches the server log.
 */
export function spawnBenchWorker(options: { heapMb: number }): Worker {
  return new Worker(new URL("./bench.worker.ts", import.meta.url), {
    resourceLimits: { maxOldGenerationSizeMb: options.heapMb },
    stdout: true,
    stderr: true,
  });
}
