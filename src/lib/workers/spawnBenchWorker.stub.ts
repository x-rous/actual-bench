/**
 * Stand-in for `spawnBenchWorker.ts` under Jest, which cannot parse the
 * `import.meta` that file needs. Tests that exercise the supervisor pass it a
 * fake worker; anything that reaches this has asked for a real thread.
 */
export function spawnBenchWorker(): never {
  throw new Error("Real worker threads are not available under Jest; pass the supervisor a fake spawn.");
}
