import type { BackupArtifact, BackupRetention } from "@/lib/app-db/backupRepository";
import type { BackupArtifactKind } from "./manifest";

/**
 * Retention (RD-077 / PR-047d).
 *
 * Deleting backups is the most dangerous thing this feature does, so the rules
 * are written as a set of *refusals* first and a schedule second. Pure and
 * side-effect free by design: every decision can be shown to the user before
 * anything is removed, and "preview" is the same code path as "prune" rather
 * than a hopeful approximation of it.
 *
 * The refusals, in order of precedence:
 *
 *   1. **Pinned copies are never pruned.** A pin is a user saying "not this
 *      one", and no policy outranks that.
 *   2. **Protected copies are never pruned while protected.** Automatic safety
 *      points take this: they were taken because something risky was about to
 *      happen, and the window where you discover the damage is measured in days.
 *   3. **Nothing younger than the minimum age is pruned**, whatever the rules
 *      say. It stops a misconfigured schedule from cycling a day's worth of
 *      backups out of existence in an afternoon.
 *   4. **The newest verified copy of each thing survives**, always. If none is
 *      verified, the newest copy survives instead. This is the rule that makes
 *      the rest safe: there is no combination of settings that empties a
 *      destination.
 *   5. **Manual backups are never pruned automatically.** Somebody took that
 *      one on purpose; Bench should not decide it has expired.
 *
 * Only then does grandfather-father-son apply: keep the newest copy of each of
 * the last N days, weeks, months and years. A copy kept by any tier is kept.
 */

export type RetentionDecision = {
  artifactId: string;
  keep: boolean;
  /** Plain language, shown verbatim in the prune preview. */
  reason: string;
};

export type RetentionPlan = {
  keep: RetentionDecision[];
  prune: RetentionDecision[];
};

type Grouped = Map<string, BackupArtifact[]>;

function groupKey(artifact: BackupArtifact): string {
  // Grouped by policy *and* kind: a budget and a copy of Bench's own database
  // are different things, and keeping seven of one must not count towards the
  // other's seven.
  return `${artifact.policyId ?? "orphan"}::${artifact.kind as BackupArtifactKind}`;
}

function group(artifacts: BackupArtifact[]): Grouped {
  const grouped: Grouped = new Map();
  for (const artifact of artifacts) {
    const key = groupKey(artifact);
    const list = grouped.get(key);
    if (list) list.push(artifact);
    else grouped.set(key, [artifact]);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return grouped;
}

function dayBucket(iso: string): string {
  return iso.slice(0, 10);
}

function weekBucket(iso: string): string {
  const date = new Date(iso);
  // ISO week: Thursday of the same week determines the year and week number.
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((thursday.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthBucket(iso: string): string {
  return iso.slice(0, 7);
}

function yearBucket(iso: string): string {
  return iso.slice(0, 4);
}

const TIERS = [
  { name: "daily", label: "day", bucket: dayBucket, limit: (r: BackupRetention) => r.daily },
  { name: "weekly", label: "week", bucket: weekBucket, limit: (r: BackupRetention) => r.weekly },
  { name: "monthly", label: "month", bucket: monthBucket, limit: (r: BackupRetention) => r.monthly },
  { name: "yearly", label: "year", bucket: yearBucket, limit: (r: BackupRetention) => r.yearly },
] as const;

function hoursBetween(from: string, to: Date): number {
  return (to.getTime() - new Date(from).getTime()) / 3_600_000;
}

/**
 * Decide what to keep and what to prune. Never touches storage.
 *
 * @param artifacts every artifact under consideration, any order
 * @param retention the policy's rules
 * @param now injected so the plan is reproducible in tests and in a preview
 */
export function planRetention(
  artifacts: BackupArtifact[],
  retention: BackupRetention,
  now: Date = new Date()
): RetentionPlan {
  const keep: RetentionDecision[] = [];
  const prune: RetentionDecision[] = [];

  for (const [, list] of group(artifacts)) {
    const survivor =
      list.find((artifact) => artifact.verificationStatus === "passed") ?? list[0] ?? null;

    // Which buckets each tier has already filled, newest first.
    const filled = new Map<string, Set<string>>(TIERS.map((tier) => [tier.name, new Set<string>()]));
    // The copy that survives unconditionally still occupies its day, week,
    // month and year. Without this, "keep 7 daily" would quietly keep eight,
    // and every tier would be off by one in the direction of using more space
    // than the user asked for.
    if (survivor) {
      for (const tier of TIERS) {
        if (tier.limit(retention) > 0) filled.get(tier.name)!.add(tier.bucket(survivor.createdAt));
      }
    }
    const autoProtectedIds = new Set(
      list
        .filter((artifact) => artifact.tier === "auto")
        .slice(0, Math.max(0, retention.autoProtectionCount))
        .map((artifact) => artifact.id)
    );

    for (const artifact of list) {
      const decide = (reason: string, shouldKeep: boolean) => {
        (shouldKeep ? keep : prune).push({ artifactId: artifact.id, keep: shouldKeep, reason });
      };

      if (artifact.pinned) {
        decide("Pinned - kept until you unpin it.", true);
        continue;
      }
      if (artifact.protectedUntil && new Date(artifact.protectedUntil) > now) {
        decide(`Protected until ${artifact.protectedUntil.slice(0, 10)}.`, true);
        continue;
      }
      if (artifact.id === survivor?.id) {
        decide(
          artifact.verificationStatus === "passed"
            ? "Newest verified copy - Bench never prunes the last good one."
            : "Newest copy - nothing verified is available to keep instead.",
          true
        );
        continue;
      }
      if (hoursBetween(artifact.createdAt, now) < retention.minimumAgeHours) {
        decide(`Less than ${retention.minimumAgeHours}h old.`, true);
        continue;
      }
      if (artifact.tier === "manual") {
        decide("Taken by hand - Bench does not expire manual backups.", true);
        continue;
      }
      if (artifact.tier === "auto") {
        const withinDays =
          hoursBetween(artifact.createdAt, now) < retention.autoProtectionDays * 24;
        if (withinDays || autoProtectedIds.has(artifact.id)) {
          decide("Recovery point, still inside its protection window.", true);
          continue;
        }
        decide("Recovery point past its protection window.", false);
        continue;
      }

      const matched = TIERS.find((tier) => {
        const limit = tier.limit(retention);
        if (limit <= 0) return false;
        const buckets = filled.get(tier.name)!;
        const bucket = tier.bucket(artifact.createdAt);
        if (buckets.has(bucket)) return false;
        if (buckets.size >= limit) return false;
        buckets.add(bucket);
        return true;
      });

      if (matched) {
        decide(`Kept as this ${matched.label}'s copy.`, true);
      } else {
        decide("Superseded by newer copies under the retention rules.", false);
      }
    }
  }

  return { keep, prune };
}
