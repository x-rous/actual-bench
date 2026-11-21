import { hasSyncCredential } from "@/lib/credentials/unattendedCredentials";
import { getAppMeta, setAppMeta } from "@/lib/app-db/appMetaRepository";
import { listBackupArtifacts, listBackupPolicies, type BackupPolicy } from "@/lib/app-db/backupRepository";
import { logger } from "@/lib/logger";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { ruleBudgetId } from "./ruleBudget";
import { runBackup } from "./runBackup";
import type { UploadedArchive } from "./uploadedArchive";

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
 * It is **off by default**, and turned on per install. The people who want it
 * and the people who find it intrusive are both real, and the cost of guessing
 * wrong is asymmetric: an unexpected full budget export in front of a save is a
 * surprise, while the absence of one is a feature nobody notices until they go
 * looking for it - and by then they have found the setting.
 */

const ENABLED_KEY = "backup.safetyPoints.enabled";
const DEBOUNCE_KEY = "backup.safetyPoints.debounceMinutes";

export type SafetyPointSettings = {
  enabled: boolean;
  debounceMinutes: number;
};

export const DEFAULT_SAFETY_SETTINGS: SafetyPointSettings = {
  enabled: false,
  debounceMinutes: 30,
};

export function readSafetySettings(db: SqliteDatabase): SafetyPointSettings {
  const enabled = getAppMeta(db, ENABLED_KEY);
  const debounce = Number(getAppMeta(db, DEBOUNCE_KEY));
  return {
    // Explicit "true" only: an install that has never been asked has not opted
    // in, and neither has one whose stored value is anything unexpected.
    enabled: enabled === null ? DEFAULT_SAFETY_SETTINGS.enabled : enabled === "true",
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
  /**
   * `needs-archive`: the rule that covers this budget takes its copy from the
   * browser (a Direct budget that is not enrolled), so the caller should
   * export the budget and ask again with the archive.
   */
  status: "taken" | "reused" | "disabled" | "unavailable" | "failed" | "needs-archive";
  message: string;
  artifactId?: string;
  takenAt?: string;
};

/**
 * The rule that protects this budget.
 *
 * Matched on the connection the user is saving through. Taking the first
 * enabled rule backed up whichever budget that rule named - another budget
 * entirely, or none for a rule that copies only Bench's settings - and then
 * reported "recovery point taken" for the budget about to be changed.
 */
export function ruleForConnection(db: SqliteDatabase, connectionFingerprint: string): BackupPolicy | null {
  return (
    listBackupPolicies(db).find(
      (policy) =>
        policy.enabled &&
        policy.contents !== "app-db" &&
        policy.destinationIds.length > 0 &&
        policy.sourceRef.data.connectionFingerprint === connectionFingerprint
    ) ?? null
  );
}

/**
 * Whether a rule's budget can only come from the browser: a Direct source, or
 * one the server holds no enrolment for. Being a manual rule says nothing
 * about that - an enrolled HTTP budget is exported by the server either way.
 */
function takesArchiveFromBrowser(db: SqliteDatabase, policy: BackupPolicy): boolean {
  if (policy.sourceRef.data.sourceKind === "direct") return true;
  const fingerprint = policy.sourceRef.data.connectionFingerprint;
  return typeof fingerprint !== "string" || !hasSyncCredential(db, fingerprint);
}

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
  input: {
    reason: string;
    /** The connection the change is being saved through. */
    connectionFingerprint?: string | null;
    /** The budget, exported by the browser, for a rule that needs it. */
    budgetArchive?: UploadedArchive | null;
    force?: boolean;
    now?: Date;
    signal?: AbortSignal;
  }
): Promise<SafetyPointOutcome> {
  const now = input.now ?? new Date();
  const settings = readSafetySettings(db);

  if (!settings.enabled && !input.force) {
    return { status: "disabled", message: "Recovery points before risky changes are turned off." };
  }

  const policy = input.connectionFingerprint ? ruleForConnection(db, input.connectionFingerprint) : null;
  if (!policy) {
    return {
      status: "unavailable",
      message:
        "No backup rule covers this budget, so Bench did not take a recovery point. Add a rule for it on the Backups page.",
    };
  }

  if (!input.force) {
    // Only a recovery point of this rule's own budget can stand in for one.
    const budgetId = ruleBudgetId(db, policy);
    const recent = listBackupArtifacts(db, { policyId: policy.id, kind: "budget", limit: 20 }).find(
      (artifact) =>
        artifact.tier === "auto" &&
        budgetId !== null &&
        artifact.sourceBudgetId === budgetId &&
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

  if (takesArchiveFromBrowser(db, policy) && !input.budgetArchive) {
    return { status: "needs-archive", message: "This budget's recovery point is exported by the browser." };
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
      signal: input.signal,
      budgetArchive: input.budgetArchive ?? null,
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
