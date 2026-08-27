import {
  listBackupArtifacts,
  listBackupDestinations,
  listBackupPolicies,
  listArtifactLocations,
  type BackupArtifact,
} from "@/lib/app-db/backupRepository";
import { nextCronRun } from "@/lib/automation/schedule";
import type { BackupPolicy } from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";

/**
 * The readiness statement (RD-077 / PR-047e).
 *
 * One sentence at the top of the Recovery Center answering the only question
 * that matters: *if this budget disappeared right now, what would I get back,
 * and how old would it be?* Everything else on the page is evidence for this
 * line.
 *
 * It is deliberately pessimistic. A backup system that reassures you is worse
 * than no backup system, so anything Bench cannot presently prove — a copy it
 * has never opened, a destination that failed last night, a single point of
 * failure — pulls the statement down rather than being rounded up.
 */

export type ReadinessStatus = "protected" | "at-risk" | "unprotected";

export type BackupReadiness = {
  status: ReadinessStatus;
  /** The headline sentence. Written to be read on its own. */
  headline: string;
  detail: string;
  newestVerified: {
    artifactId: string;
    createdAt: string;
    ageHours: number;
    budgetName: string | null;
  } | null;
  totalCopies: number;
  destinationCount: number;
  /** More than one destination holding at least one copy. */
  redundant: boolean;
  issues: string[];
};

function hoursSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 3_600_000;
}

/**
 * How often a rule is supposed to produce a copy, in hours.
 *
 * Measured from the rule's own schedule rather than assumed, because a fixed
 * "older than two days is stale" rule marks a healthy weekly backup as at-risk
 * forever — and a readiness statement that cries wolf is one people stop
 * reading, which is the only way this page can truly fail.
 */
function periodHours(policy: BackupPolicy, now: Date): number | null {
  if (policy.scheduleKind === "interval") {
    return policy.intervalMinutes ? policy.intervalMinutes / 60 : null;
  }
  if (!policy.cronExpression) return null;
  try {
    const first = nextCronRun(policy.cronExpression, policy.timezone, now.getTime());
    if (first === null) return null;
    const second = nextCronRun(policy.cronExpression, policy.timezone, first);
    if (second === null) return null;
    return (second - first) / 3_600_000;
  } catch {
    return null;
  }
}

/**
 * When a backup counts as overdue: two periods, plus an hour of slack.
 *
 * Two rather than one because a single missed run is often a restart or a
 * server that was briefly down, and reporting that as "at risk" the moment a
 * schedule slips would be noise. Two missed runs is a pattern.
 */
export function stalenessThresholdHours(policies: BackupPolicy[], now: Date): number {
  const periods = policies
    .filter((policy) => policy.enabled)
    .map((policy) => periodHours(policy, now))
    .filter((hours): hours is number => hours !== null && hours > 0);

  // With no usable schedule, fall back to a day and a half — long enough not to
  // nag a daily backup that ran late, short enough to notice a dead one.
  if (periods.length === 0) return 36;
  return Math.min(...periods) * 2 + 1;
}

function describeAge(hours: number): string {
  if (hours < 1) return "less than an hour ago";
  if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function buildBackupReadiness(db: SqliteDatabase, now: Date = new Date()): BackupReadiness {
  const policies = listBackupPolicies(db);
  const destinations = listBackupDestinations(db);
  const artifacts = listBackupArtifacts(db, { limit: 500 });
  const issues: string[] = [];

  const stored = artifacts.filter((artifact) =>
    listArtifactLocations(db, artifact.id).some((location) => location.status === "stored")
  );
  const verified = stored.filter((artifact) => artifact.verificationStatus === "passed");
  const newest = verified[0] ?? null;

  const destinationsHoldingCopies = new Set(
    stored.flatMap((artifact) =>
      listArtifactLocations(db, artifact.id)
        .filter((location) => location.status === "stored" && location.destinationId)
        .map((location) => location.destinationId as string)
    )
  );

  const base = {
    newestVerified: newest ? verifiedSummary(newest, now) : null,
    totalCopies: stored.length,
    destinationCount: destinationsHoldingCopies.size,
    redundant: destinationsHoldingCopies.size > 1,
  };

  if (policies.length === 0 || destinations.length === 0) {
    return {
      ...base,
      status: "unprotected",
      headline: "Nothing is being backed up.",
      detail:
        destinations.length === 0
          ? "Add a destination — a folder on this server, or an S3-compatible bucket — and Bench can start keeping verified copies."
          : "Add a backup rule to start taking copies on a schedule.",
      issues,
    };
  }

  if (stored.length === 0) {
    return {
      ...base,
      status: "unprotected",
      headline: "No backup has been stored yet.",
      detail: "A rule exists, but nothing has run successfully. Use “Back up now” to take the first copy.",
      issues,
    };
  }

  // Anything Bench cannot prove counts against readiness.
  const failedVerification = stored.filter((artifact) => artifact.verificationStatus === "failed");
  if (failedVerification.length > 0) {
    issues.push(
      `${failedVerification.length} stored ${
        failedVerification.length === 1 ? "copy" : "copies"
      } failed verification and should not be relied on.`
    );
  }

  const brokenDestinations = destinations.filter(
    (destination) =>
      destination.enabled &&
      destination.lastFailureAt &&
      (!destination.lastSuccessAt || destination.lastFailureAt > destination.lastSuccessAt)
  );
  for (const destination of brokenDestinations) {
    issues.push(`${destination.name} last failed: ${destination.lastFailureReason ?? "unknown error"}`);
  }

  if (!base.redundant) {
    issues.push("Every copy is in one destination. Losing it loses all of them.");
  }

  const disabledPolicies = policies.filter((policy) => !policy.enabled);
  if (disabledPolicies.length === policies.length) {
    issues.push("Every backup rule is paused, so no new copies are being taken.");
  }

  if (!newest) {
    return {
      ...base,
      status: "at-risk",
      headline: "There are copies, but none Bench has been able to read.",
      detail:
        "A stored copy that has never verified might restore and might not. Run “Verify now” to find out which.",
      issues,
    };
  }

  const ageHours = hoursSince(newest.createdAt, now);
  const threshold = stalenessThresholdHours(policies, now);
  const stale = ageHours > threshold;
  if (stale) {
    issues.push(
      `The newest verified copy is ${describeAge(ageHours)}, which is more than this schedule should allow.`
    );
  }

  const atRisk = stale || failedVerification.length > 0 || brokenDestinations.length > 0;

  return {
    ...base,
    status: atRisk ? "at-risk" : "protected",
    headline: atRisk
      ? `Your last verified backup is from ${describeAge(ageHours)}, and something needs attention.`
      : `You could restore a verified backup from ${describeAge(ageHours)}.`,
    detail: `${base.totalCopies} stored ${base.totalCopies === 1 ? "copy" : "copies"} across ${
      base.destinationCount
    } destination${base.destinationCount === 1 ? "" : "s"}${
      base.redundant ? ", so no single failure loses everything." : "."
    }`,
    issues,
  };
}

function verifiedSummary(artifact: BackupArtifact, now: Date) {
  return {
    artifactId: artifact.id,
    createdAt: artifact.createdAt,
    ageHours: hoursSince(artifact.createdAt, now),
    budgetName: artifact.sourceBudgetName,
  };
}
