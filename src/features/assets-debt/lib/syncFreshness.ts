import type { ActualBenchTransport } from "@/lib/actual/transport";

/**
 * When this tab last pulled changes from Actual, per connection (owner decision 2026-10-07): a
 * single apply syncs first only when the last sync is older than 30 seconds; a bulk apply and a
 * refresh always sync. In Direct mode the check just before a write reads this browser's copy, so
 * a recent sync keeps it close to Actual without a sync on every click.
 */

const lastSync = new Map<string, number>();
export const SYNC_FRESH_MS = 30_000;

/** Sync now (or only when stale); a failed sync is not fatal: the write's own check still applies. */
export async function syncIfNeeded(connectionId: string, transport: Pick<ActualBenchTransport, "sync">, mode: "always" | "if-stale"): Promise<void> {
  if (mode === "if-stale" && Date.now() - (lastSync.get(connectionId) ?? 0) < SYNC_FRESH_MS) return;
  try {
    await transport.sync();
    lastSync.set(connectionId, Date.now());
  } catch {
    // keep going on what this browser has
  }
}

/** Record a sync done elsewhere (the refresh). */
export function noteSynced(connectionId: string): void {
  lastSync.set(connectionId, Date.now());
}
