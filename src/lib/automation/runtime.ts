import { sweepStaleWorkspaces } from "@/lib/actual/runtime/workspace";
import { getAppDb } from "@/lib/app-db/connection";
import { clearAutomationClaims } from "@/lib/app-db/automationRepository";
import { logger } from "@/lib/logger";
import { vaultEnabled } from "@/lib/sync/vault";
import { ensureWorkerPreflight } from "@/lib/workers/supervisor";
import { ensureAutomationJobTypesRegistered } from "./bootstrap";
import { runEngineTick } from "./engine";
import { getAutomationExecutor } from "./executor";

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
/** A claim younger than this may still belong to a run that is really going. */
const BOOT_CLAIM_GRACE_MS = 15 * 60_000;
const INITIAL_DELAY_MS = 5_000;
let started = false;

function sweepWorkspaces(): void {
  try {
    const swept = sweepStaleWorkspaces();
    if (swept > 0) logger.info(`[automation] removed ${swept} budget workspace(s) left by workers that are gone`);
  } catch (error) {
    logger.warn(
      `[automation] could not sweep budget workspaces: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function startAutomationEngine(): void {
  if (started) return;
  started = true;

  // Recover claims left by a process that died mid-run, without assuming this
  // is the only process alive. Clearing *every* claim at boot would, if someone
  // runs two containers against one database, cancel a run the other container
  // is still executing — so only claims older than the boot grace are released.
  // A crashed run therefore recovers in minutes rather than when the claim goes
  // fully stale hours later, and a live run is never stolen.
  try {
    const released = clearAutomationClaims(getAppDb(), BOOT_CLAIM_GRACE_MS);
    if (released > 0) logger.info(`[automation] released ${released} claim(s) left by a previous process`);
  } catch (error) {
    logger.warn(
      `[automation] could not clear stale claims: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Budget copies left by workers that are gone, including those of a
  // process that died. Again at every tick, so a crash's leftovers do not
  // wait for the next restart; a workspace in use is touched every minute
  // and is never swept, whichever process owns it.
  sweepWorkspaces();

  logger.info(
    `[automation] engine started (vault ${vaultEnabled() ? "enabled" : "disabled - credential-backed automations will pause"})`
  );

  // Jobs run in worker threads unless the operator chose otherwise. Check now
  // that one can start, so a deployment where it cannot says so in App Health
  // at boot rather than at the first scheduled run.
  const checkWorkers = async (): Promise<void> => {
    if (getAutomationExecutor().name !== "worker") return;
    const result = await ensureWorkerPreflight();
    if (result.status === "ready") {
      logger.info(`[automation] worker threads ready (heap limit ${result.heapLimitMb} MB)`);
    }
  };
  void checkWorkers().catch((error: unknown) =>
    logger.warn(`[automation] worker check failed: ${error instanceof Error ? error.message : String(error)}`)
  );

  const tick = async (): Promise<void> => {
    try {
      // Cheap once workers are known to work; after a failed check it tries
      // again every few minutes, so fixing the cause needs no restart.
      if (getAutomationExecutor().name === "worker") await ensureWorkerPreflight();
      // Idempotent, and cheap: it costs two map writes and removes any
      // dependence on which module instance happened to run first.
      ensureAutomationJobTypesRegistered();
      sweepWorkspaces();
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
