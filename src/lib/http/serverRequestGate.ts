/**
 * The seam that lets browser-safe code reach the server's per-server request
 * lock without importing it.
 *
 * `src/lib/api/client.ts` runs in the browser as well as on the server, so it
 * cannot import `serverQueue.ts`, which pulls in the app database and with it a
 * native module. The server-only module installs itself here when it loads;
 * `client.ts` asks for it at call time.
 *
 * Kept on `globalThis` rather than in module state, for the same reason the
 * queue is: Next evaluates route modules separately from `instrumentation.ts`,
 * and a gate installed in one module instance must be visible from another.
 */

export type ServerRequestTarget = {
  baseUrl: string;
  apiKey: string;
  budgetSyncId?: string;
};

export type ServerRequestGate = <T extends { status: number }>(
  target: ServerRequestTarget,
  reqId: string,
  operation: () => Promise<T>,
  options?: { leaseTtlMs?: number }
) => Promise<T>;

const GATE_KEY = Symbol.for("actual-bench.serverRequestGate");

type GateHolder = { [GATE_KEY]?: ServerRequestGate };

export function installServerRequestGate(gate: ServerRequestGate): void {
  (globalThis as GateHolder)[GATE_KEY] = gate;
}

/** The installed gate, or `null` when no server module has loaded it. */
export function getServerRequestGate(): ServerRequestGate | null {
  return (globalThis as GateHolder)[GATE_KEY] ?? null;
}
