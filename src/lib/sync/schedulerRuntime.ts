import { getAppDb } from "@/lib/app-db/connection";
import { logger } from "@/lib/logger";
import { runSchedulerTick } from "./serverScheduler";
import { vaultEnabled } from "./vault";

/**
 * Boots the in-process unattended scheduler (RD-058 / PR-024c). Called once from
 * `instrumentation.ts` on server startup; only active when the vault is enabled.
 * A single-instance interval loop - no external cron required.
 */

const TICK_MS = 60_000;
const INITIAL_DELAY_MS = 5_000;
let started = false;

export function startUnattendedScheduler(): void {
  if (started) return;
  if (!vaultEnabled()) {
    logger.info("[sync] unattended scheduler disabled (SYNC_VAULT_KEY unset)");
    return;
  }
  started = true;
  logger.info("[sync] unattended scheduler started");

  const tick = async () => {
    try {
      const summary = await runSchedulerTick(getAppDb());
      if (summary.ran.length > 0) {
        logger.info(`[sync] scheduler tick ran ${summary.ran.length} flow(s): ${summary.ran.map((r) => `${r.flowId}=${r.status}${r.message ? ` (${r.message})` : ""}`).join(", ")}`);
      }
    } catch (err) {
      logger.warn(`[sync] scheduler tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const interval = setInterval(() => void tick(), TICK_MS);
  interval.unref?.();
  setTimeout(() => void tick(), INITIAL_DELAY_MS).unref?.();
}
