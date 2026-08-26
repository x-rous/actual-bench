import { listAutomations } from "@/lib/app-db/automationRepository";
import { listAutomationRuns } from "@/lib/app-db/automationRunRepository";
import { vaultEnabled } from "@/lib/sync/vault";
import { getAutomationJobType } from "./registry";
import { isAutomationRunning, runningAutomationIds } from "./engine";
import { MIN_INTERVAL_MINUTES, describeSchedule, nextCronRun } from "./schedule";
import type { AutomationDefinition, AutomationRun, SqliteDatabase } from "@/lib/app-db/types";

/**
 * Health for one automation, and for all of them (RD-079 / PR-043e).
 *
 * Shaped for RD-086 to consume directly: one typed accessor, no scraping of the
 * UI and no decoding of a global snapshot blob. The judgement it encodes, which
 * RD-086 asked for explicitly, is that **staleness is a warning in its own
 * right**. An automation whose last run succeeded three weeks ago on an hourly
 * schedule is not healthy just because nothing failed — most likely nothing ran
 * at all, which is the failure mode a "last run: succeeded" badge hides.
 */

export type AutomationHealthStatus = "ok" | "warning" | "failing" | "paused" | "idle";

export type AutomationHealth = {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  status: AutomationHealthStatus;
  /** One plain sentence a person can act on. */
  summary: string;
  enabled: boolean;
  executionMode: AutomationDefinition["executionMode"];
  schedule: string;
  running: boolean;
  lastRunAt: string | null;
  lastRunStatus: AutomationRun["status"] | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  consecutiveFailures: number;
  autoPausedAt: string | null;
  autoPauseReason: string | null;
  /** Overdue by more than the grace factor below. */
  stale: boolean;
};

export type AutomationHealthReport = {
  checkedAt: string;
  /** In-process, single-instance — stated, not implied. */
  singleInstance: true;
  vaultEnabled: boolean;
  runningIds: string[];
  automations: AutomationHealth[];
  counts: Record<AutomationHealthStatus, number>;
};

/**
 * How late a run may be before it is called stale: three missed occurrences,
 * floored at an hour so a 15-minute automation is not flagged the moment a
 * deploy restarts the process.
 *
 * The factor genuinely applies — a flat hour would call a daily backup overdue
 * at 01:00 the same night, which is noise, and would never distinguish a weekly
 * job that is an hour late from one that has not run in a month.
 */
export const STALE_GRACE_FACTOR = 3;
const MIN_STALE_GRACE_MS = 60 * 60_000;
/**
 * Upper bound on the grace. Three missed occurrences of a monthly schedule is a
 * quarter of silence; past a week, "it has not run" is worth saying whatever the
 * cadence, and a warning nobody sees for three months is not a warning.
 */
const MAX_STALE_GRACE_MS = 7 * 24 * 60 * 60_000;
/** Only used when a cron expression cannot be read at all. */
const FALLBACK_CRON_INTERVAL_MINUTES = 24 * 60;

type StaleInput = Pick<
  AutomationDefinition,
  | "enabled"
  | "autoPausedAt"
  | "nextRunAt"
  | "scheduleKind"
  | "intervalMinutes"
  | "cronExpression"
  | "timezone"
>;

type ScheduleShape = Pick<
  StaleInput,
  "scheduleKind" | "intervalMinutes" | "cronExpression" | "timezone" | "nextRunAt"
>;

/**
 * The gap between two consecutive occurrences, in minutes.
 *
 * Measured from the schedule itself rather than assumed. Treating every cron as
 * daily called a monthly job overdue after three days, when it had missed
 * nothing at all.
 */
function occurrenceMinutes(automation: ScheduleShape): number {
  if (automation.scheduleKind !== "cron") {
    return Math.max(automation.intervalMinutes ?? 0, MIN_INTERVAL_MINUTES);
  }
  if (!automation.cronExpression) return FALLBACK_CRON_INTERVAL_MINUTES;

  const parsed = automation.nextRunAt ? Date.parse(automation.nextRunAt) : Date.now();
  const base = Number.isNaN(parsed) ? Date.now() : parsed;

  try {
    // Two *consecutive* occurrences. Measuring from `nextRunAt` to the following
    // occurrence measures whatever is left of the current gap instead of the
    // cadence: for `0 */12 * * *` anchored at 03:00 that is nine hours, not
    // twelve, which would under-grace a schedule the whole point is to respect.
    const first = nextCronRun(automation.cronExpression, automation.timezone, base);
    if (first === null) return FALLBACK_CRON_INTERVAL_MINUTES;
    const second = nextCronRun(automation.cronExpression, automation.timezone, first);
    if (second === null) return FALLBACK_CRON_INTERVAL_MINUTES;
    return Math.max(Math.round((second - first) / 60_000), 1);
  } catch {
    return FALLBACK_CRON_INTERVAL_MINUTES;
  }
}

export function staleGraceMs(automation: ScheduleShape): number {
  const graceMs = occurrenceMinutes(automation) * STALE_GRACE_FACTOR * 60_000;
  return Math.min(Math.max(graceMs, MIN_STALE_GRACE_MS), MAX_STALE_GRACE_MS);
}

export function isStale(automation: StaleInput, nowMs: number): boolean {
  if (!automation.enabled || automation.autoPausedAt) return false;
  if (!automation.nextRunAt) return false;

  const due = Date.parse(automation.nextRunAt);
  if (Number.isNaN(due)) return false;

  return nowMs - due > staleGraceMs(automation);
}

function statusFor(
  automation: AutomationDefinition,
  lastRun: AutomationRun | null,
  stale: boolean
): { status: AutomationHealthStatus; summary: string } {
  if (automation.autoPausedAt) {
    return {
      status: "paused",
      summary: automation.autoPauseReason ?? "Paused automatically after repeated failures.",
    };
  }

  if (!automation.enabled) {
    return { status: "idle", summary: "Turned off. It will not run until you enable it." };
  }

  if (automation.consecutiveFailures > 0) {
    const attempts = automation.consecutiveFailures === 1 ? "attempt" : "attempts";
    return {
      status: "failing",
      summary: `Last ${automation.consecutiveFailures} ${attempts} failed${
        lastRun?.rollup?.message ? `: ${lastRun.rollup.message}` : "."
      }`,
    };
  }

  if (stale) {
    return {
      status: "warning",
      summary: automation.nextRunAt
        ? `Overdue — it was due to run at ${automation.nextRunAt} and has not. Check that the server is running.`
        : "Overdue — no run has happened when one was expected.",
    };
  }

  if (!lastRun) {
    return { status: "idle", summary: "Has not run yet." };
  }

  if (lastRun.status === "partial") {
    return {
      status: "warning",
      summary: lastRun.rollup?.message ?? "Last run finished with some items unfinished.",
    };
  }

  return {
    status: "ok",
    summary: lastRun.rollup?.message ?? "Last run finished successfully.",
  };
}

export function buildAutomationHealth(
  db: SqliteDatabase,
  options: { nowMs?: number } = {}
): AutomationHealthReport {
  const nowMs = options.nowMs ?? Date.now();
  const counts: Record<AutomationHealthStatus, number> = {
    ok: 0,
    warning: 0,
    failing: 0,
    paused: 0,
    idle: 0,
  };

  const automations = listAutomations(db).map((automation) => {
    const [lastRun] = listAutomationRuns(db, { automationId: automation.id, limit: 1 });
    const stale = isStale(automation, nowMs);
    const { status, summary } = statusFor(automation, lastRun ?? null, stale);
    counts[status] += 1;

    return {
      id: automation.id,
      name: automation.name,
      type: automation.type,
      typeLabel: getAutomationJobType(automation.type)?.label ?? automation.type,
      status,
      summary,
      enabled: automation.enabled,
      executionMode: automation.executionMode,
      schedule: describeSchedule(automation),
      running: isAutomationRunning(automation),
      lastRunAt: automation.lastRunAt,
      lastRunStatus: lastRun?.status ?? null,
      lastSuccessAt: automation.lastSuccessAt,
      nextRunAt: automation.nextRunAt,
      consecutiveFailures: automation.consecutiveFailures,
      autoPausedAt: automation.autoPausedAt,
      autoPauseReason: automation.autoPauseReason,
      stale,
    } satisfies AutomationHealth;
  });

  return {
    checkedAt: new Date(nowMs).toISOString(),
    singleInstance: true,
    vaultEnabled: vaultEnabled(),
    runningIds: runningAutomationIds(),
    automations,
    counts,
  };
}

/** Worst status across all automations, for a single roll-up badge. */
export function overallAutomationStatus(report: AutomationHealthReport): AutomationHealthStatus {
  if (report.counts.failing > 0) return "failing";
  if (report.counts.paused > 0) return "paused";
  if (report.counts.warning > 0) return "warning";
  if (report.counts.ok > 0) return "ok";
  return "idle";
}
