import type { ActualBenchTransport } from "@/lib/actual/transport";

/** Every explicit loan operation syncs first; failures propagate and block approval. */

const lastSync = new Map<string, number>();

/** The legacy mode argument is accepted, but neither mode bypasses a successful sync. */
export async function syncIfNeeded(connectionId: string, transport: Pick<ActualBenchTransport, "sync">, mode: "always" | "if-stale"): Promise<void> {
  void mode;
  await transport.sync();
  lastSync.set(connectionId, Date.now());
}

/** Record a sync done elsewhere (the refresh). */
export function noteSynced(connectionId: string): void {
  lastSync.set(connectionId, Date.now());
}
