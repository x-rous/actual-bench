import { getAppMeta, setAppMeta } from "@/lib/app-db/appMetaRepository";
import { listBackupArtifacts, listBackupPolicies } from "@/lib/app-db/backupRepository";
import { logger } from "@/lib/logger";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { runBackup } from "./runBackup";

/**
 * Safety recovery points (RD-077 / PR-047f).
 *
 * A backup taken *because of what you are about to do*, rather than because of
 * what time it is. Merging forty payees, applying a reconciliation, saving a
 * month of budget edits — these are the moments people wish they had a backup
 * from five minutes ago rather than from last night, and Bench is the thing
 * about to make the change, so it is the thing that can take one first.
 *
 * Three rules keep it from being a nuisance:
 *
 *   * **Only for changes worth it.** Renaming one payee does not warrant a full
 *     export; the caller decides what counts as risky and Bench trusts it.
 *   * **Debounced.** Several risky operations in one working session share a
 *     recovery point. Without this, an afternoon of cleanup would take a dozen
 *     copies of the same budget minutes apart.
 *   * **Protected, not pinned.** These expire — after the protection window, or
 *     once enough newer ones exist. A pin is a decision a person makes; a
 *     recovery point taken automatically should not silently accumulate
 *     forever, which is the failure mode of every "safety snapshot" feature
 *     that never cleans up after itself.
 *
 * It is on by default and can be turned off, because the people who most want
 * it and the people who find it intrusive are both real.
 */

const ENABLED_KEY = "backup.safetyPoints.enabled";
const DEBOUNCE_KEY = "backup.safetyPoints.debounceMinutes";

export type SafetyPointSettings = {
  enabled: boolean;
  debounceMinutes: number;
};

export const DEFAULT_SAFETY_SETTINGS: SafetyPointSettings = {
  enabled: true,
  debounceMinutes: 30,
};

export function readSafetySettings(db: SqliteDatabase): SafetyPointSettings {
  const enabled = getAppMeta(db, ENABLED_KEY);
  const debounce = Number(getAppMeta(db, DEBOUNCE_KEY));
  return {
    enabled: enabled === null ? DEFAULT_SAFETY_SETTINGS.enabled : enabled !== "false",
    debounceMinutes: Number.isFinite(debounce) && debounce > 0 ? debounce : DEFAULT_SAFETY_SETTINGS.debounceMinutes,
  };
}

export function writeSafetySettings(
  db: SqliteDatabase,
  settings: Partial<SafetyPointSettings>
): SafetyPointSettings {
  if (settings.enabled !== undefined) setAppMeta(db, ENABLED_KEY, settings.enabled ? "true" : "false");
  if (settings.debounceMinutes !== undefined) {
    setAppMeta(db, DEBOUNCE_KEY, String(Math.max(1, Math.round(settings.debounceMinutes))));
  }
  return readSafetySettings(db);
}

export type SafetyPointOutcome = {
  status: "taken" | "reused" | "disabled" | "unavailable" | "failed";
  message: string;
  artifactId?: string;
  takenAt?: string;
};

/**
 * Take a recovery point before something risky, unless there is a good reason
 * not to.
 *
 * Never throws: the caller is in the middle of a user action, and an exception
 * here would turn "the backup did not happen" into "your change did not happen".
 * Every outcome is a status the caller can decide what to do about.
 */
export async function takeSafetyRecoveryPoint(
  db: SqliteDatabase,
  input: { reason: string; force?: boolean; now?: Date }
): Promise<SafetyPointOutcome> {
  const now = input.now ?? new Date();
  const settings = readSafetySettings(db);

  if (!settings.enabled && !input.force) {
    return { status: "disabled", message: "Recovery points before risky changes are turned off." };
  }

  const policy = listBackupPolicies(db).find(
    (entry) =>
      entry.enabled &&
      entry.destinationIds.length > 0 &&
      typeof entry.sourceRef.data.connectionFingerprint === "string"
  );
  if (!policy) {
    return {
      status: "unavailable",
      message:
        "Bench has no backup rule it can use, so it cannot take a recovery point before this change.",
    };
  }

  if (!input.force) {
    const recent = listBackupArtifacts(db, { policyId: policy.id, limit: 20 }).find(
      (artifact) =>
        artifact.tier === "auto" &&
        now.getTime() - new Date(artifact.createdAt).getTime() < settings.debounceMinutes * 60_000
    );
    if (recent) {
      return {
        status: "reused",
        message: `Using the recovery point taken at ${recent.createdAt.slice(11, 16)} - it is recent enough.`,
        artifactId: recent.id,
        takenAt: recent.createdAt,
      };
    }
  }

  const protectedUntil = new Date(
    now.getTime() + policy.retention.autoProtectionDays * 24 * 3_600_000
  ).toISOString();

  try {
    const result = await runBackup(db, policy, {
      trigger: "safety",
      tier: "auto",
      takenBefore: input.reason,
      protectedUntil,
      now,
      // The budget alone: this protects against a change about to be made to
      // the budget, and copying Bench's own settings too would double the time
      // the user waits for something they did not ask for.
      contentsOverride: "budget",
    });

    if (!result.stored) {
      return {
        status: "failed",
        message: result.message ?? "Bench could not store a recovery point.",
      };
    }

    const artifactId = result.artifacts.find((artifact) => artifact.artifactId)?.artifactId ?? undefined;
    return {
      status: "taken",
      message: result.verified
        ? "Recovery point taken and verified."
        : "Recovery point stored, but Bench could not confirm it is readable.",
      artifactId,
      takenAt: result.startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[backup] safety recovery point failed: ${message}`);
    return { status: "failed", message };
  }
}
