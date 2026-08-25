import { getAppDb } from "@/lib/app-db/connection";
import { clearAutomationClaims } from "@/lib/app-db/automationRepository";
import { logger } from "@/lib/logger";
import { vaultEnabled } from "@/lib/sync/vault";
import { runEngineTick } from "./engine";

/**
 * Boots the in-process automation engine (RD-079 / PR-043b). Called once from
 * `instrumentation.ts` on server startup — a single-instance interval loop, no
 * external cron required, exactly as RD-058 established.
 *
 * Unlike RD-058's sync scheduler, this loop starts **whether or not the vault
 * is enabled**. Not every automation needs a credential (a browser-mode job, or
 * a server job acting on local state), so refusing to start at all would
 * silently disable jobs that would have worked. Automations that *do* name a
 * credential fail closed individually, in `resolveCredentials`, with the reason
 * visible on the automation itself.
 */

const TICK_MS = 60_000;
const INITIAL_DELAY_MS = 5_000;
let started = false;

export function startAutomationEngine(): void {
  if (started) return;
  started = true;

  // Any execution claim surviving a boot belongs to a process that no longer
  // exists — the engine is single-instance, so nothing else can be holding one.
  // Without this a run killed mid-flight would block its automation until the
  // claim went stale hours later.
  try {
    const released = clearAutomationClaims(getAppDb());
    if (released > 0) logger.info(`[automation] released ${released} claim(s) left by a previous process`);
  } catch (error) {
    logger.warn(
      `[automation] could not clear stale claims: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  logger.info(
    `[automation] engine started (vault ${vaultEnabled() ? "enabled" : "disabled - credential-backed automations will pause"})`
  );

  const tick = async (): Promise<void> => {
    try {
      const summary = await runEngineTick(getAppDb());
      if (summary.ran.length > 0) {
        const detail = summary.ran
          .map((outcome) => `${outcome.automationId}=${outcome.status}${outcome.message ? ` (${outcome.message})` : ""}`)
          .join(", ");
        logger.info(`[automation] tick ran ${summary.ran.length} automation(s): ${detail}`);
      }
    } catch (error) {
      logger.warn(`[automation] tick failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const interval = setInterval(() => void tick(), TICK_MS);
  interval.unref?.();
  setTimeout(() => void tick(), INITIAL_DELAY_MS).unref?.();
}
