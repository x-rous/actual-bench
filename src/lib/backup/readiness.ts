import {
  listBackupArtifacts,
  listBackupDestinations,
  listBackupPolicies,
  listLocationsByArtifact,
  type BackupArtifact,
} from "@/lib/app-db/backupRepository";
import { plausibilityOf } from "./verificationRecord";
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

/** One rule's answer to "what would I get back, and how old would it be?". */
export type RuleReadiness = {
  policyId: string;
  name: string;
  /** What this rule's readiness is judged on: its budget, or Bench's settings for a settings-only rule. */
  subject: "budget" | "app-db";
  status: ReadinessStatus;
  enabled: boolean;
  manual: boolean;
  budgetName: string | null;
  newestVerifiedAt: string | null;
  ageHours: number | null;
  /** The rule's problems, worst first; empty when it is protected. */
  issues: string[];
};

export type BackupReadiness = {
  status: ReadinessStatus;
  /** The headline sentence. Written to be read on its own. */
  headline: string;
  detail: string;
  /** The newest verified copy of the rule that is worst off (the one the headline is about). */
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
  /**
   * Each rule on its own. A readiness worked out across everything let one
   * healthy rule - or a fresh copy of Bench's own settings - say "protected"
   * while another budget had not been backed up for weeks.
   */
  rules: RuleReadiness[];
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
  // A manual rule runs when someone presses the button; it is never late.
  if (policy.scheduleKind === "manual") return null;
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
  // Two queries for the whole inventory, not two per artifact.
  const artifacts = listBackupArtifacts(db, { limit: "all" });
  const locations = listLocationsByArtifact(db);
  const issues: string[] = [];

  const isStored = (artifact: BackupArtifact) =>
    (locations.get(artifact.id) ?? []).some((location) => location.status === "stored");
  const stored = artifacts.filter(isStored);

  const destinationsHoldingCopies = new Set(
    stored.flatMap((artifact) =>
      (locations.get(artifact.id) ?? [])
        .filter((location) => location.status === "stored" && location.destinationId)
        .map((location) => location.destinationId as string)
    )
  );

  const rules = policies.map((policy) => ruleReadiness(policy, stored, now));
  const active = rules.filter((rule) => rule.enabled);
  const worst = worstRule(active.length > 0 ? active : rules);
  const worstArtifact = worst
    ? (stored.find(
        (artifact) =>
          artifact.policyId === worst.policyId &&
          artifact.kind === worst.subject &&
          artifact.verificationStatus === "passed"
      ) ?? null)
    : null;

  const base = {
    newestVerified: worstArtifact ? verifiedSummary(worstArtifact, now) : null,
    totalCopies: stored.length,
    destinationCount: destinationsHoldingCopies.size,
    redundant: destinationsHoldingCopies.size > 1,
    rules,
  };

  if (policies.length === 0 || destinations.length === 0) {
    return {
      ...base,
      status: "unprotected",
      headline: "Nothing is being backed up.",
      detail:
        destinations.length === 0
          ? "Add a destination - a folder on this server, or an S3-compatible bucket - and Bench can start keeping verified copies."
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

  if (active.length === 0) {
    issues.push("Every backup rule is paused, so no new copies are being taken.");
  }

  // A single rule's problems are listed here; with several, each rule's row
  // carries its own, so the list keeps to what affects them all.
  if (rules.length === 1) issues.push(...rules[0].issues);

  const status: ReadinessStatus =
    worst?.status === "unprotected"
      ? "unprotected"
      : worst?.status === "at-risk" || brokenDestinations.length > 0 || active.length === 0
        ? "at-risk"
        : "protected";

  return {
    ...base,
    status,
    headline: headlineFor(status, rules.length, worst, active.length),
    detail: `${base.totalCopies} stored ${base.totalCopies === 1 ? "copy" : "copies"} across ${
      base.destinationCount
    } destination${base.destinationCount === 1 ? "" : "s"}${
      base.redundant ? ", so no single failure loses everything." : "."
    }`,
    issues,
  };
}

const RANK: Record<ReadinessStatus, number> = { unprotected: 2, "at-risk": 1, protected: 0 };

function worstRule(rules: RuleReadiness[]): RuleReadiness | null {
  let worst: RuleReadiness | null = null;
  for (const rule of rules) {
    if (
      !worst ||
      RANK[rule.status] > RANK[worst.status] ||
      (RANK[rule.status] === RANK[worst.status] && (rule.ageHours ?? Infinity) > (worst.ageHours ?? Infinity))
    ) {
      worst = rule;
    }
  }
  return worst;
}

function headlineFor(
  status: ReadinessStatus,
  ruleCount: number,
  worst: RuleReadiness | null,
  activeCount: number
): string {
  if (!worst) return "Nothing is being backed up.";
  const subject = ruleCount > 1 ? `“${worst.name}”` : "Your";
  if (worst.ageHours === null) {
    return ruleCount > 1
      ? `${subject} has no verified copy, so its budget cannot be restored with confidence.`
      : "There are copies, but none Bench has been able to read.";
  }
  const age = describeAge(worst.ageHours);
  if (status === "protected") {
    return ruleCount > 1
      ? `Every backup rule has a verified copy; the least recent is “${worst.name}”, from ${age}.`
      : `You could restore a verified backup from ${age}.`;
  }
  if (activeCount === 0) return `Your last verified backup is from ${age}, and every rule is paused.`;
  return ruleCount > 1
    ? `${subject} needs attention: its last verified copy is from ${age}.`
    : `Your last verified backup is from ${age}, and something needs attention.`;
}

/**
 * One rule's readiness, judged on the thing it protects: its budget (even
 * when it also copies Bench's settings), or Bench's settings for a rule that
 * copies only those.
 */
function ruleReadiness(policy: BackupPolicy, stored: BackupArtifact[], now: Date): RuleReadiness {
  const subject: RuleReadiness["subject"] = policy.contents === "app-db" ? "app-db" : "budget";
  const mine = stored.filter((artifact) => artifact.policyId === policy.id && artifact.kind === subject);
  const newest = mine[0] ?? null;
  const verified = mine.find((artifact) => artifact.verificationStatus === "passed") ?? null;
  const issues: string[] = [];
  const base = {
    policyId: policy.id,
    name: policy.name,
    subject,
    enabled: policy.enabled,
    manual: policy.scheduleKind === "manual",
    budgetName: newest?.sourceBudgetName ?? null,
    newestVerifiedAt: verified?.createdAt ?? null,
    ageHours: verified ? hoursSince(verified.createdAt, now) : null,
  };

  if (!policy.enabled) issues.push("This rule is paused.");

  if (!newest) {
    issues.unshift("No copy has been stored yet.");
    return { ...base, status: "unprotected", issues };
  }

  // Only the newest copy's state matters here: an old failure that retention
  // happens to keep says nothing about whether the rule works today.
  if (newest.verificationStatus === "failed") {
    const { unresolved, readable } = plausibilityOf(newest);
    issues.unshift(
      unresolved.length > 0 && readable
        ? "The newest copy is noticeably smaller than the last good one. Review it, and accept the change if you made it."
        : "The newest copy failed verification and should not be relied on."
    );
  }

  if (!verified) {
    issues.unshift("No copy has been verified, so none can be relied on.");
    return { ...base, status: "at-risk", issues };
  }

  const threshold = policy.enabled ? stalenessThresholdHours([policy], now) : null;
  const manual = policy.scheduleKind === "manual";
  if (!manual && threshold !== null && base.ageHours !== null && base.ageHours > threshold) {
    issues.unshift(
      `The newest verified copy is ${describeAge(base.ageHours)}, which is more than this schedule should allow.`
    );
  }

  return { ...base, status: issues.some((issue) => issue !== "This rule is paused.") ? "at-risk" : "protected", issues };
}

function verifiedSummary(artifact: BackupArtifact, now: Date) {
  return {
    artifactId: artifact.id,
    createdAt: artifact.createdAt,
    ageHours: hoursSince(artifact.createdAt, now),
    budgetName: artifact.sourceBudgetName,
  };
}
