import { getAppDb } from "@/lib/app-db/connection";
import { listBackupDestinations } from "@/lib/app-db/backupRepository";
import { scrubAll, type ScrubResult } from "@/lib/backup/scrub";
import { getAutomationJobType, registerAutomationJobType } from "../registry";
import { BACKUP_SCRUB_JOB_TYPE } from "./backupType";
import type { AutomationJobType, AutomationRunContext } from "../registry";
import type { AutomationRunRollup, JsonEnvelope } from "@/lib/app-db/types";

/**
 * Scrub as an automation job type (RD-077 / PR-047d).
 *
 * Weekly re-verification of the newest copies in every destination. This is the
 * job that turns "we took a backup" into "there is a backup there right now,
 * and it opens" — storage rots quietly, and nothing announces a truncated
 * object or a bucket someone tidied up.
 *
 * Damage found is a **failure**, and this one does count against the streak,
 * unlike a partial backup. The reasoning is the mirror image: a backup run
 * failing means today's copy is missing, which tomorrow's run may fix on its
 * own, whereas a scrub failing means copies that already exist are bad, and
 * nothing about repeating the scrub will improve them. That deserves the
 * automation's health going red and staying red until someone looks.
 */

export { BACKUP_SCRUB_JOB_TYPE } from "./backupType";

export type BackupScrubConfig = {
  /** Empty means every enabled destination. */
  destinationIds: string[];
  newest: number;
  deepest: number;
};

export type BackupScrubResult = {
  destinations: ScrubResult[];
};

export const backupScrubJobType: AutomationJobType<BackupScrubConfig, BackupScrubResult> = {
  type: BACKUP_SCRUB_JOB_TYPE,
  label: "Verify backups",

  validateConfig(raw: JsonEnvelope): BackupScrubConfig {
    const ids = Array.isArray(raw.data.destinationIds)
      ? raw.data.destinationIds.filter((entry): entry is string => typeof entry === "string")
      : [];
    const newest = typeof raw.data.newest === "number" ? raw.data.newest : 3;
    const deepest = typeof raw.data.deepest === "number" ? raw.data.deepest : 1;
    return { destinationIds: ids, newest, deepest };
  },

  async run(ctx: AutomationRunContext<BackupScrubConfig>): Promise<BackupScrubResult> {
    const db = getAppDb();
    const ids =
      ctx.config.destinationIds.length > 0
        ? ctx.config.destinationIds
        : listBackupDestinations(db)
            .filter((destination) => destination.enabled)
            .map((destination) => destination.id);

    ctx.logger.info(`Verifying the newest ${ctx.config.newest} copies in ${ids.length} destination(s)`);
    const destinations = await scrubAll(db, ids, {
      newest: ctx.config.newest,
      deepest: ctx.config.deepest,
    });

    for (const result of destinations) {
      if (result.failed > 0 || result.missing > 0) {
        ctx.logger.error(
          `${result.destinationName}: ${result.failed} damaged, ${result.missing} missing.`
        );
      }
    }

    return { destinations };
  },

  summarize(result: BackupScrubResult): AutomationRunRollup {
    const checked = result.destinations.reduce((total, entry) => total + entry.checked, 0);
    const failed = result.destinations.reduce((total, entry) => total + entry.failed, 0);
    const missing = result.destinations.reduce((total, entry) => total + entry.missing, 0);
    const skipped = result.destinations.reduce((total, entry) => total + entry.skipped, 0);
    const unreachable = result.destinations.filter((entry) => entry.error);

    if (failed > 0 || missing > 0) {
      return {
        outcome: "failed",
        itemCount: checked,
        message: `${failed} damaged and ${missing} missing copy(ies) found.`,
      };
    }
    if (unreachable.length > 0) {
      return {
        outcome: "partial",
        itemCount: checked,
        message: `${unreachable.length} destination(s) could not be reached: ${unreachable[0].error}`,
        // A destination being unreachable this week says nothing about the
        // copies in it; the next scrub will find out.
        countsAsFailure: false,
      };
    }
    if (checked === 0) {
      return { outcome: "no_changes", itemCount: 0, message: "There are no stored copies to verify yet." };
    }

    // A copy Bench could not open is not a verified copy, and the run should
    // not read as though everything was checked.
    if (skipped > 0) {
      return {
        outcome: "partial",
        itemCount: checked - skipped,
        message: `${checked - skipped} copy(ies) verified; ${skipped} could not be opened (no stored passphrase).`,
        countsAsFailure: false,
      };
    }

    return { outcome: "ok", itemCount: checked, message: `${checked} copy(ies) verified.` };
  },

  serializeResult(result: BackupScrubResult): JsonEnvelope {
    return {
      version: 1,
      data: {
        destinations: result.destinations.map((entry) => ({
          destinationId: entry.destinationId,
          destinationName: entry.destinationName,
          checked: entry.checked,
          passed: entry.passed,
          failed: entry.failed,
          missing: entry.missing,
          // Kept in the stored result: a run that could not open two copies
          // reads very differently from one that verified them all, and the
          // history is where anyone looks afterwards.
          skipped: entry.skipped,
          error: entry.error ?? null,
          artifacts: entry.artifacts.map((artifact) => ({
            artifactId: artifact.artifactId,
            objectKey: artifact.objectKey,
            status: artifact.status,
            level: artifact.level,
            detail: artifact.detail,
          })),
        })),
      },
    };
  },

  // No `reconcile`: the scrub automation is created and retired alongside the
  // backup rules it protects, in `reconcileBackupAutomations`.
};

/**
 * Idempotent, and keyed on the registry rather than on a module-level flag.
 *
 * A boolean here and the registry map live in separate modules, and a dev
 * server can replace one without the other - after which this function would
 * try to register a type the registry already had, and throw. The registry is
 * the thing being guarded, so it is the thing to ask.
 */
export function registerBackupScrubJobType(): void {
  if (getAutomationJobType(BACKUP_SCRUB_JOB_TYPE)) return;
  registerAutomationJobType(backupScrubJobType);
}

/** Test-only, retained for callers: the registry check above needs no reset. */
export function __resetBackupScrubRegistrationForTests(): void {}
