import { getSyncFlow, listSyncFlows } from "@/lib/app-db/syncFlowRepository";
import { listSyncFlowRuns } from "@/lib/app-db/syncRunRepository";
import {
  createAutomation,
  deleteAutomation,
  listAutomations,
  updateAutomation,
} from "@/lib/app-db/automationRepository";
import { decodeFlowPlanConfig } from "@/lib/sync/flowConfig";
import { logger } from "@/lib/logger";
import { MIN_INTERVAL_MINUTES } from "../schedule";
import { BUDGET_FILE_SYNC_JOB_TYPE } from "./budgetFileSyncType";
import type { AutomationDefinition, SqliteDatabase, SyncFlow } from "@/lib/app-db/types";

/**
 * Move enrolled unattended sync flows onto the automation engine (PR-043c).
 *
 * Runs on every engine tick (via the budget-file-sync job type's `reconcile`
 * hook, not just at boot) and is **idempotent**: it is keyed on the flow id
 * inside the automation's config, so a repeated run does not create
 * duplicates and does not overwrite a schedule the user has since changed in
 * the Automations UI.
 *
 * What it deliberately does *not* do: re-enrol credentials, or touch flows
 * that are not unattended. A flow the user never asked to run unattended must
 * not start running unattended because of an upgrade. It *does* keep an
 * already-enrolled automation's interval in sync with the flow's own interval
 * field on every tick - the Automations page has no schedule editor for this
 * job type, so the Sync flow editor is the only place that can change it - but
 * only for as long as that automation is still on an interval schedule. Once
 * something has moved it to cron, its schedule belongs to whoever did that.
 */

export type MigrationSummary = {
  created: string[];
  updated: string[];
  removed: string[];
  skipped: number;
};

function flowIdOf(automation: AutomationDefinition): string | null {
  const flowId = automation.config.data.flowId;
  return typeof flowId === "string" ? flowId : null;
}

/**
 * Where in its cycle a migrated flow already is.
 *
 * Read from the flow's own run history — the same measurement RD-058's
 * scheduler made — so an upgrade does not restart every schedule from zero. A
 * pending manual preview (`draft_preview`) is skipped, exactly as the old
 * scheduler skipped it, because previewing a flow is not running it.
 *
 * Null when the flow has never completed a run: then "now" is genuinely the
 * right time for its first one.
 */
function seedNextRunAt(db: SqliteDatabase, flowId: string, intervalMinutes: number): string | undefined {
  const lastCompleted = listSyncFlowRuns(db, { flowId, limit: 20 }).find(
    (run) => run.status !== "draft_preview"
  );
  if (!lastCompleted) return undefined;

  const lastAtMs = Date.parse(lastCompleted.finishedAt ?? lastCompleted.startedAt);
  if (Number.isNaN(lastAtMs)) return undefined;

  const effective = Math.max(intervalMinutes, MIN_INTERVAL_MINUTES);
  return new Date(lastAtMs + effective * 60_000).toISOString();
}

export function migrateSyncFlowsToAutomations(db: SqliteDatabase): MigrationSummary {
  // One transaction for the whole batch, so an upgrade that fails partway
  // leaves no half-migrated set of automations behind.
  return db.transaction(() => migrateInTransaction(db))() as MigrationSummary;
}

function migrateInTransaction(db: SqliteDatabase): MigrationSummary {
  const summary: MigrationSummary = { created: [], updated: [], removed: [], skipped: 0 };

  const existingByFlow = new Map<string, AutomationDefinition>();
  for (const automation of listAutomations(db, { type: BUDGET_FILE_SYNC_JOB_TYPE })) {
    const flowId = flowIdOf(automation);
    if (flowId) existingByFlow.set(flowId, automation);
  }

  for (const flow of listSyncFlows(db)) {
    try {
      // Each flow gets its own nested transaction, which better-sqlite3 runs
      // as a SAVEPOINT. Two things follow: one flow's bad config cannot block
      // every other flow in the batch (without this, a single unrelated flow
      // throwing meant a brand new unattended flow's automation silently never
      // got created, with nothing in the UI to explain why), and a flow that
      // throws *after* a write of its own is rolled back to the savepoint
      // rather than left half-applied.
      db.transaction(() => migrateOneFlow(db, flow, existingByFlow, summary))();
    } catch (error) {
      logger.warn(
        `[automation] sync flow migration: could not migrate flow ${flow.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // A flow that has been deleted leaves an automation pointing at nothing. It
  // stayed enabled, so the engine kept firing it every interval, each run
  // failing with `flow_not_found` until the failure policy paused it - an
  // automation nobody can fix, named after a flow that no longer exists.
  //
  // Removing it is safe now that `automation_runs.automation_id` is ON DELETE
  // SET NULL (schema v30): the runs it already recorded survive as orphans and
  // stay in the run history, listed as "Deleted automation".
  //
  // Confirmed against the database rather than against the flow list above: a
  // transiently empty read would otherwise delete every sync automation in the
  // install.
  for (const [flowId, automation] of existingByFlow) {
    if (getSyncFlow(db, flowId)) continue;
    deleteAutomation(db, automation.id);
    summary.removed.push(automation.id);
  }

  if (summary.created.length > 0 || summary.updated.length > 0 || summary.removed.length > 0) {
    logger.info(
      `[automation] sync flow migration: ${summary.created.length} created, ${summary.updated.length} updated, ${summary.removed.length} removed, ${summary.skipped} not unattended`
    );
  }

  return summary;
}

function migrateOneFlow(
  db: SqliteDatabase,
  flow: SyncFlow,
  existingByFlow: Map<string, AutomationDefinition>,
  summary: MigrationSummary
): void {
  const config = decodeFlowPlanConfig(flow);
  const existing = existingByFlow.get(flow.id);
  const unattended = config.reviewPolicy === "auto_sync_unattended";

  if (!unattended) {
    summary.skipped += 1;
    // A flow switched back to manual review must stop running. Leaving its
    // automation enabled meant it kept firing, recording a run each interval
    // that could do nothing, until it auto-paused itself.
    if (existing?.enabled) {
      updateAutomation(db, existing.id, { enabled: false });
      summary.updated.push(existing.id);
    }
    return;
  }

  if (existing) {
    const patch: { enabled?: boolean; intervalMinutes?: number } = {};

    // **Only ever turn it off, never on.** Following the flow's enabled state
    // in both directions meant a user who pressed Pause on the Automations
    // page had their automation silently re-enabled by the next server
    // restart, because the flow itself was still enabled in the Sync UI. It
    // would also have cleared nothing while re-enabling something the engine
    // had health-paused, leaving a row that reads "on" but never runs.
    const flowStopped = !flow.enabled || Boolean(config.autoPausedAt);
    if (flowStopped && existing.enabled) patch.enabled = false;

    // The interval, unlike enabled/disabled, has no other UI to change it
    // from once the flow is enrolled - the Automations page doesn't expose
    // a schedule editor for this job type, so the Sync flow editor's
    // interval field must be the one source of truth for as long as the
    // flow is enrolled. updateAutomation already drops any stale
    // `next_run_at` floor computed under the old interval.
    //
    // Only while it is still *on* an interval schedule, though: a cron row
    // stores `interval_minutes` as NULL, so an unguarded comparison never
    // matches, and the resulting write would clear `next_run_at` on every
    // tick forever while never making the comparison stop matching.
    if (existing.scheduleKind === "interval" && config.intervalMinutes !== existing.intervalMinutes) {
      patch.intervalMinutes = config.intervalMinutes;
    }

    // One write, one summary entry: two separate updates double-counted the
    // same automation in the batch log.
    if (Object.keys(patch).length > 0) {
      updateAutomation(db, existing.id, patch);
      summary.updated.push(existing.id);
    }
    return;
  }

  const created = createAutomation(db, {
    type: BUDGET_FILE_SYNC_JOB_TYPE,
    name: flow.name,
    enabled: flow.enabled && !config.autoPausedAt,
    executionMode: "server",
    scheduleKind: "interval",
    intervalMinutes: config.intervalMinutes,
    timezone: "UTC",
    targetRef: { version: 1, data: { flowId: flow.id } },
    // The source connection is the one whose credential the run needs first;
    // `runServerSafeSync` resolves both ends itself, so this reference exists
    // for the engine's fail-closed check and for health display.
    credentialRef: config.sourceConnectionFingerprint || null,
    config: { version: 1, data: { flowId: flow.id } },
    // Carry the flow's existing schedule position across. Without this the
    // automation has no run history, `nextIntervalRun` treats it as never-run,
    // and **every** migrated flow syncs at once seconds after the upgrade —
    // including one that synced two minutes before it.
    nextRunAt: seedNextRunAt(db, flow.id, config.intervalMinutes),
  });
  summary.created.push(created.id);
}
