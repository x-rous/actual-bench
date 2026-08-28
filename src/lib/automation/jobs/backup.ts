import { getAppDb } from "@/lib/app-db/connection";
import {
  getBackupPolicy,
  listBackupArtifacts,
  listBackupPolicies,
} from "@/lib/app-db/backupRepository";
import { prune, type PruneResult } from "@/lib/backup/prune";
import { runBackup, type BackupRunResult } from "@/lib/backup/runBackup";
import { registerAutomationJobType } from "../registry";
import { BACKUP_JOB_TYPE } from "./backupType";
import { reconcileBackupAutomations } from "./backupReconcile";
import type { AutomationJobType, AutomationRunContext } from "../registry";
import type { AutomationRunRollup, JsonEnvelope } from "@/lib/app-db/types";

/**
 * Backup as an automation job type (RD-077 / PR-047d).
 *
 * The engine already knows how to run something on a schedule, hold a lock,
 * back off after failures, keep history and report health. A backup needs every
 * one of those and none of them are backup-specific, so this type is thin on
 * purpose: take the backup, apply retention, and translate the outcome into the
 * engine's vocabulary.
 *
 * The translation is where the judgement lives, and one decision matters more
 * than the rest: **a partial backup does not count against the failure streak.**
 * The engine auto-pauses an automation that keeps failing, which is right for a
 * sync hammering a server that rejects it, and wrong here — pausing a backup
 * because one of two destinations is unreachable would stop the copies that
 * were still working. A run that stored *nothing* is a plain failure and does
 * count; anything that got a copy somewhere is reported honestly as partial and
 * left running.
 */

export { BACKUP_JOB_TYPE } from "./backupType";

export type BackupJobConfig = {
  policyId: string;
};

export type BackupJobResult = {
  policyId: string;
  run: BackupRunResult;
  prune: PruneResult | null;
};

export const backupJobType: AutomationJobType<BackupJobConfig, BackupJobResult> = {
  type: BACKUP_JOB_TYPE,
  label: "Backup",

  validateConfig(raw: JsonEnvelope): BackupJobConfig {
    const policyId = raw.data.policyId;
    if (typeof policyId !== "string" || !policyId.trim()) {
      throw new Error("This automation has no backup rule to run (policyId is missing).");
    }
    return { policyId: policyId.trim() };
  },

  async run(ctx: AutomationRunContext<BackupJobConfig>): Promise<BackupJobResult> {
    const db = getAppDb();
    const policy = getBackupPolicy(db, ctx.config.policyId);
    if (!policy) {
      throw new Error("This backup rule no longer exists.");
    }

    ctx.logger.info(`Backing up "${policy.name}" to ${policy.destinationIds.length} destination(s)`);
    const result = await runBackup(db, policy, { trigger: "scheduled" });

    for (const artifact of result.artifacts) {
      for (const destination of artifact.destinations) {
        if (destination.status === "failed") {
          ctx.logger.warn(`${destination.destinationName}: ${destination.error ?? "failed"}`);
        }
      }
      if (artifact.verification && artifact.verification.status !== "passed") {
        ctx.logger.warn(
          `The ${artifact.kind} copy was stored but did not verify: ${
            artifact.verification.findings[0] ?? "unknown reason"
          }`
        );
      }
    }

    // Retention runs only when something was actually stored. Pruning after a
    // failed backup would delete an old copy to make room for one that does not
    // exist — precisely when the old copies matter most.
    let pruneResult: PruneResult | null = null;
    if (result.stored) {
      pruneResult = await prune(db, {
        artifacts: listBackupArtifacts(db, { policyId: policy.id, limit: 500 }),
        retention: policy.retention,
      });
      if (pruneResult.pruned.length > 0) {
        ctx.logger.info(`Retention removed ${pruneResult.pruned.length} older copy(ies).`);
      }
    }

    return { policyId: policy.id, run: result, prune: pruneResult };
  },

  summarize(result: BackupJobResult): AutomationRunRollup {
    const { run } = result;
    const copies = run.artifacts.flatMap((artifact) => artifact.destinations).filter(
      (destination) => destination.status === "stored"
    ).length;

    if (!run.stored) {
      return {
        outcome: "failed",
        itemCount: 0,
        message: run.message ?? "No copy could be stored.",
      };
    }

    const failedDestinations = run.artifacts
      .flatMap((artifact) => artifact.destinations)
      .filter((destination) => destination.status === "failed");

    if (!run.verified) {
      return {
        outcome: "partial",
        itemCount: copies,
        message: run.message ?? "Stored, but Bench could not confirm the copy is readable.",
        // Deliberately not a failure for streak purposes: an unreadable source
        // budget would otherwise pause the very automation that keeps trying to
        // capture it, and the copy on disk is still better than nothing.
        countsAsFailure: false,
      };
    }

    if (failedDestinations.length > 0) {
      return {
        outcome: "partial",
        itemCount: copies,
        message: `Stored ${copies} copy(ies); ${failedDestinations.length} destination(s) failed.`,
        countsAsFailure: false,
      };
    }

    const pruned = result.prune?.pruned.length ?? 0;
    return {
      outcome: "ok",
      itemCount: copies,
      message:
        pruned > 0
          ? `Verified ${copies} copy(ies); removed ${pruned} older one(s).`
          : `Verified ${copies} copy(ies).`,
    };
  },

  serializeResult(result: BackupJobResult): JsonEnvelope {
    return {
      version: 1,
      data: {
        policyId: result.policyId,
        stored: result.run.stored,
        verified: result.run.verified,
        message: result.run.message ?? null,
        artifacts: result.run.artifacts.map((artifact) => ({
          kind: artifact.kind,
          artifactId: artifact.artifactId,
          status: artifact.status,
          sizeBytes: artifact.sizeBytes,
          verification: artifact.verification
            ? {
                level: artifact.verification.level,
                status: artifact.verification.status,
                findings: artifact.verification.findings.slice(0, 5),
              }
            : null,
          destinations: artifact.destinations.map((destination) => ({
            destinationId: destination.destinationId,
            destinationName: destination.destinationName,
            status: destination.status,
            objectKey: destination.objectKey,
            sizeBytes: destination.sizeBytes,
            error: destination.error ?? null,
          })),
        })),
        prune: result.prune
          ? {
              removed: result.prune.pruned.filter((entry) => entry.removed).length,
              failed: result.prune.failed,
              freedBytes: result.prune.freedBytes,
              entries: result.prune.pruned.slice(0, 20).map((entry) => ({
                artifactId: entry.artifactId,
                reason: entry.reason,
                createdAt: entry.createdAt,
                sizeBytes: entry.sizeBytes,
              })),
            }
          : null,
      },
    };
  },

  /**
   * Backup rules are created and edited on the Backups page while the server is
   * up, so their automations are reconciled every tick rather than at boot —
   * the lesson Budget File Sync learned when a flow enrolled after startup
   * silently never ran.
   */
  reconcile(db) {
    reconcileBackupAutomations(db, listBackupPolicies(db));
  },

  // A backup constructs nothing through Bench's write pipeline: it reads a
  // budget and stores bytes. Nothing to review, so no classification.
};

let registered = false;

export function registerBackupJobType(): void {
  if (registered) return;
  registerAutomationJobType(backupJobType);
  registered = true;
}

/** Test-only: allow re-registration after the registry is reset. */
export function __resetBackupRegistrationForTests(): void {
  registered = false;
}
