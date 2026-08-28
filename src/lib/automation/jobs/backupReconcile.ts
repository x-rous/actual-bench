import {
  createAutomation,
  deleteAutomation,
  listAutomations,
  pauseAutomationForHealth,
  updateAutomation,
} from "@/lib/app-db/automationRepository";
import { listAutomationRuns } from "@/lib/app-db/automationRunRepository";
import { logger } from "@/lib/logger";
import { getBackupPolicy } from "@/lib/app-db/backupRepository";
import type { BackupPolicy } from "@/lib/app-db/backupRepository";
import type { AutomationDefinition, SqliteDatabase } from "@/lib/app-db/types";
import { BACKUP_JOB_TYPE, BACKUP_SCRUB_JOB_TYPE } from "./backupType";

/**
 * Keeping backup automations in step with backup rules (RD-077 / PR-047d).
 *
 * A backup rule is edited on the Backups page; the thing that makes it happen
 * on time is an automation. Rather than making the user maintain both, the rule
 * is the source of truth and its automation is derived — created when the rule
 * appears, rescheduled when its schedule changes, disabled when the rule is.
 *
 * Two rules carried over from Budget File Sync's migration, both learned the
 * hard way:
 *
 *   * It runs **every tick**, not at boot, because a rule created while the
 *     server is up would otherwise silently never run until the next restart.
 *   * Enabling only ever follows the rule *off*, never back *on*. Someone who
 *     pressed Pause on the Automations page must not have it undone by the next
 *     reconcile, and an automation the engine health-paused must stay paused.
 */

export type BackupReconcileSummary = {
  created: string[];
  updated: string[];
  /** Automations whose rule is gone, and which therefore had nothing to run. */
  removed: string[];
};

function policyIdOf(automation: AutomationDefinition): string | null {
  const policyId = automation.config.data.policyId;
  return typeof policyId === "string" ? policyId : null;
}

function scheduleFor(policy: BackupPolicy) {
  return policy.scheduleKind === "interval"
    ? {
        scheduleKind: "interval" as const,
        intervalMinutes: policy.intervalMinutes ?? 1440,
        cronExpression: null,
        timezone: policy.timezone,
      }
    : {
        scheduleKind: "cron" as const,
        cronExpression: policy.cronExpression ?? "0 2 * * *",
        intervalMinutes: null,
        timezone: policy.timezone,
      };
}

function scheduleChanged(automation: AutomationDefinition, policy: BackupPolicy): boolean {
  const wanted = scheduleFor(policy);
  return (
    automation.scheduleKind !== wanted.scheduleKind ||
    automation.cronExpression !== wanted.cronExpression ||
    automation.intervalMinutes !== wanted.intervalMinutes ||
    automation.timezone !== wanted.timezone ||
    automation.name !== policy.name
  );
}

export function reconcileBackupAutomations(
  db: SqliteDatabase,
  policies: BackupPolicy[]
): BackupReconcileSummary {
  return db.transaction(() => reconcileInTransaction(db, policies))() as BackupReconcileSummary;
}

function reconcileInTransaction(db: SqliteDatabase, policies: BackupPolicy[]): BackupReconcileSummary {
  const summary: BackupReconcileSummary = { created: [], updated: [], removed: [] };

  const existingByPolicy = new Map<string, AutomationDefinition>();
  for (const automation of listAutomations(db, { type: BACKUP_JOB_TYPE })) {
    const policyId = policyIdOf(automation);
    if (policyId) existingByPolicy.set(policyId, automation);
  }

  for (const policy of policies) {
    const existing = existingByPolicy.get(policy.id);

    if (!existing) {
      const created = createAutomation(db, {
        type: BACKUP_JOB_TYPE,
        name: policy.name,
        enabled: policy.enabled,
        executionMode: "server",
        ...scheduleFor(policy),
        targetRef: { version: 1, data: { policyId: policy.id } },
        // The source connection's credential is what a run needs first, so the
        // engine's fail-closed check has something real to check against.
        credentialRef:
          typeof policy.sourceRef.data.connectionFingerprint === "string"
            ? policy.sourceRef.data.connectionFingerprint
            : null,
        config: { version: 1, data: { policyId: policy.id } },
      });
      summary.created.push(created.id);
      continue;
    }

    const changes: Record<string, unknown> = {};
    if (scheduleChanged(existing, policy)) {
      Object.assign(changes, scheduleFor(policy), { name: policy.name });
    }
    // Off follows the rule; on never does.
    if (!policy.enabled && existing.enabled) changes.enabled = false;

    if (Object.keys(changes).length > 0) {
      updateAutomation(db, existing.id, changes);
      summary.updated.push(existing.id);
    }
  }

  // A rule that has been deleted leaves an automation with nothing to run.
  //
  // What happens to it depends on whether it has history. Deleting an
  // automation cascades to its runs, so removing one that has run would erase
  // the record of backups that actually happened - the copies are kept, and
  // their explanation should be too. One that never ran has nothing to lose and
  // is removed, because a paused row that has never done anything is clutter.
  //
  // Confirmed against the database rather than against the list passed in: a
  // transiently empty read would otherwise delete every backup automation in
  // the install.
  for (const [policyId, automation] of existingByPolicy) {
    if (getBackupPolicy(db, policyId)) continue;

    const hasHistory = listAutomationRuns(db, { automationId: automation.id, limit: 1 }).length > 0;
    if (!hasHistory) {
      deleteAutomation(db, automation.id);
      summary.removed.push(automation.id);
      continue;
    }

    if (automation.enabled || !automation.autoPausedAt) {
      updateAutomation(db, automation.id, { enabled: false });
      pauseAutomationForHealth(
        db,
        automation.id,
        new Date().toISOString(),
        "The backup rule this ran was deleted. Its backups are kept; the rule is not."
      );
      summary.updated.push(automation.id);
    }
  }

  reconcileScrubAutomation(db, policies, summary);

  if (summary.created.length > 0) {
    logger.info(`[automation] backup rules: ${summary.created.length} automation(s) created`);
  }

  return summary;
}

/**
 * One scrub automation for the whole install, not one per rule.
 *
 * Scrubbing is about destinations, and several rules usually share the same
 * ones. A scrub per rule would re-read the same objects several times a week
 * for no additional confidence — and on metered object storage, re-reading is
 * the part that costs money.
 */
function reconcileScrubAutomation(
  db: SqliteDatabase,
  policies: BackupPolicy[],
  summary: BackupReconcileSummary
): void {
  const wanted = policies.some((policy) => policy.enabled && policy.scrubEnabled);
  const [existing] = listAutomations(db, { type: BACKUP_SCRUB_JOB_TYPE });

  if (!existing) {
    if (!wanted) return;
    const created = createAutomation(db, {
      type: BACKUP_SCRUB_JOB_TYPE,
      name: "Verify stored backups",
      enabled: true,
      executionMode: "server",
      scheduleKind: "cron",
      // Sunday early morning: a weekly check that lands before the week's work
      // starts, and well away from the nightly backup window.
      cronExpression: "0 4 * * 0",
      timezone: policies[0]?.timezone ?? "UTC",
      targetRef: { version: 1, data: {} },
      config: { version: 1, data: {} },
    });
    summary.created.push(created.id);
    return;
  }

  if (!wanted && existing.enabled) {
    updateAutomation(db, existing.id, { enabled: false });
    summary.updated.push(existing.id);
  }
}
