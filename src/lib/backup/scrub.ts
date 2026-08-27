import { getBackupCredential } from "@/lib/app-db/backupCredentialRepository";
import {
  getBackupArtifact,
  getBackupDestination,
  getBackupPolicy,
  listBackupArtifacts,
  listDestinationLocations,
  recordArtifactLocation,
  recordArtifactVerification,
  recordDestinationOutcome,
  type BackupArtifact,
  type BackupDestination,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { createDestinationAdapter } from "./destinations";
import { decryptArchive } from "./encryption";
import { sha256, type BackupVerificationLevel } from "./manifest";
import { verifyAppDbArchive, verifyBudgetArchive } from "./verify";

/**
 * Scrub — re-verifying backups that already exist (RD-077 / PR-047d).
 *
 * Storage rots quietly. A copy that verified when it was written can be
 * truncated by a full volume, silently corrupted by a failing disk, or removed
 * by someone tidying up a bucket, and nothing announces any of it. Weekly
 * re-verification of the newest few copies is what turns "we took a backup" into
 * "there is a backup there right now, and it opens".
 *
 * What it does, per destination:
 *
 *   * **Presence and size.** The cheapest question, and the one that catches a
 *     deleted or truncated object immediately.
 *   * **Checksum.** Re-read the bytes and compare against what was recorded.
 *     Bit rot does not change a file's size.
 *   * **Contents.** Open the newest copy properly — decrypting first when the
 *     policy's passphrase is stored, so an encrypted backup is proved to be
 *     *decryptable*, not merely present. An encrypted backup nobody can open is
 *     the most expensive kind of false confidence there is.
 *
 * A copy that has gone missing is marked missing rather than deleted: the
 * distinction matters when deciding whether retention or a disk ate it.
 */

export type ScrubArtifactResult = {
  artifactId: string;
  objectKey: string;
  status: "passed" | "failed" | "missing";
  level: BackupVerificationLevel | "checksum";
  detail: string;
};

export type ScrubResult = {
  destinationId: string;
  destinationName: string;
  checked: number;
  passed: number;
  failed: number;
  missing: number;
  artifacts: ScrubArtifactResult[];
  error?: string;
};

export type ScrubOptions = {
  /** How many of the newest copies to check per destination. */
  newest?: number;
  /** How many of those to open fully rather than checksum. */
  deepest?: number;
  now?: Date;
};

function passphraseFor(db: SqliteDatabase, artifact: BackupArtifact): string | null {
  if (!artifact.encrypted || !artifact.policyId) return null;
  const policy = getBackupPolicy(db, artifact.policyId);
  if (!policy?.encryptionCredentialRef) return null;
  try {
    const secret = getBackupCredential(db, policy.encryptionCredentialRef);
    return secret && "passphrase" in secret ? secret.passphrase : null;
  } catch {
    return null;
  }
}

export async function scrubDestination(
  db: SqliteDatabase,
  destination: BackupDestination,
  options: ScrubOptions = {}
): Promise<ScrubResult> {
  const now = options.now ?? new Date();
  const at = now.toISOString();
  const newest = Math.max(1, options.newest ?? 3);
  const deepest = Math.max(0, options.deepest ?? 1);

  const result: ScrubResult = {
    destinationId: destination.id,
    destinationName: destination.name,
    checked: 0,
    passed: 0,
    failed: 0,
    missing: 0,
    artifacts: [],
  };

  let adapter;
  try {
    adapter = createDestinationAdapter(db, destination);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    recordDestinationOutcome(db, destination.id, { success: false, at, reason: result.error });
    return result;
  }

  const locations = listDestinationLocations(db, destination.id, { limit: 100 })
    .filter((location) => location.status === "stored")
    .slice(0, newest);

  for (const [index, location] of locations.entries()) {
    const artifact = getBackupArtifact(db, location.artifactId);
    if (!artifact) continue;
    result.checked += 1;

    try {
      const head = await adapter.head(location.objectKey);
      if (!head) {
        result.missing += 1;
        recordArtifactLocation(db, {
          artifactId: artifact.id,
          destinationId: destination.id,
          objectKey: location.objectKey,
          status: "missing",
          lastError: "The object is no longer in this destination.",
        });
        result.artifacts.push({
          artifactId: artifact.id,
          objectKey: location.objectKey,
          status: "missing",
          level: "checksum",
          detail: "The copy is gone from this destination.",
        });
        continue;
      }

      if (head.sizeBytes !== artifact.sizeBytes) {
        result.failed += 1;
        recordArtifactVerification(db, artifact.id, {
          level: artifact.verificationLevel ?? "archive",
          status: "failed",
          at,
          findings: {
            version: 1,
            data: {
              findings: [
                `Stored size ${head.sizeBytes} does not match the recorded ${artifact.sizeBytes} bytes.`,
              ],
            },
          },
        });
        result.artifacts.push({
          artifactId: artifact.id,
          objectKey: location.objectKey,
          status: "failed",
          level: "checksum",
          detail: `Size changed: ${head.sizeBytes} bytes now, ${artifact.sizeBytes} when written.`,
        });
        continue;
      }

      const bytes = await adapter.get(location.objectKey);
      const checksum = sha256(bytes);
      if (checksum !== artifact.checksumSha256) {
        result.failed += 1;
        recordArtifactVerification(db, artifact.id, {
          level: artifact.verificationLevel ?? "archive",
          status: "failed",
          at,
          findings: {
            version: 1,
            data: { findings: ["The stored bytes no longer match the checksum recorded when written."] },
          },
        });
        result.artifacts.push({
          artifactId: artifact.id,
          objectKey: location.objectKey,
          status: "failed",
          level: "checksum",
          detail: "The bytes have changed since they were written.",
        });
        continue;
      }

      // Only the newest few are opened; the rest are proved intact by checksum,
      // which is what actually detects rot.
      if (index >= deepest) {
        recordArtifactLocation(db, {
          artifactId: artifact.id,
          destinationId: destination.id,
          objectKey: location.objectKey,
          status: "stored",
          lastVerifiedAt: at,
        });
        result.passed += 1;
        result.artifacts.push({
          artifactId: artifact.id,
          objectKey: location.objectKey,
          status: "passed",
          level: "checksum",
          detail: "Present, right size, checksum matches.",
        });
        continue;
      }

      let plaintext: Uint8Array = bytes;
      if (artifact.encrypted) {
        const passphrase = passphraseFor(db, artifact);
        if (!passphrase) {
          // Not a failure: Bench simply cannot open it unattended. Say so
          // rather than implying the copy is bad or that it is proven good.
          recordArtifactLocation(db, {
            artifactId: artifact.id,
            destinationId: destination.id,
            objectKey: location.objectKey,
            status: "stored",
            lastVerifiedAt: at,
          });
          result.passed += 1;
          result.artifacts.push({
            artifactId: artifact.id,
            objectKey: location.objectKey,
            status: "passed",
            level: "checksum",
            detail:
              "Present and unchanged. Bench has no stored passphrase for it, so its contents were not opened.",
          });
          continue;
        }
        plaintext = decryptArchive(bytes, passphrase);
      }

      const outcome =
        artifact.kind === "budget"
          ? verifyBudgetArchive(plaintext, "deep")
          : verifyAppDbArchive(plaintext, "data");

      recordArtifactVerification(db, artifact.id, {
        level: outcome.level,
        status: outcome.status,
        at,
        findings: { version: 1, data: { findings: outcome.findings } },
      });
      recordArtifactLocation(db, {
        artifactId: artifact.id,
        destinationId: destination.id,
        objectKey: location.objectKey,
        status: "stored",
        lastVerifiedAt: at,
        lastError: outcome.status === "failed" ? outcome.findings[0] ?? "Verification failed." : null,
      });

      if (outcome.status === "passed") result.passed += 1;
      else result.failed += 1;

      result.artifacts.push({
        artifactId: artifact.id,
        objectKey: location.objectKey,
        status: outcome.status,
        level: outcome.level,
        detail:
          outcome.status === "passed"
            ? artifact.encrypted
              ? "Decrypted, opened and read."
              : "Opened and read."
            : outcome.findings[0] ?? "Verification failed.",
      });
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      result.artifacts.push({
        artifactId: artifact.id,
        objectKey: location.objectKey,
        status: "failed",
        level: "checksum",
        detail: message,
      });
    }
  }

  recordDestinationOutcome(db, destination.id, {
    success: result.failed === 0 && result.missing === 0,
    at,
    reason:
      result.failed > 0 || result.missing > 0
        ? `Scrub found ${result.failed} damaged and ${result.missing} missing ${
            result.failed + result.missing === 1 ? "copy" : "copies"
          }.`
        : undefined,
  });

  return result;
}

/** Scrub every enabled destination that holds at least one copy. */
export async function scrubAll(
  db: SqliteDatabase,
  destinationIds: string[],
  options: ScrubOptions = {}
): Promise<ScrubResult[]> {
  const results: ScrubResult[] = [];
  for (const id of destinationIds) {
    const destination = getBackupDestination(db, id);
    if (!destination || !destination.enabled) continue;
    results.push(await scrubDestination(db, destination, options));
  }
  return results;
}

/** Destinations worth scrubbing: enabled, and holding something. */
export function scrubbableDestinationIds(db: SqliteDatabase, ids: string[]): string[] {
  return ids.filter((id) => {
    const destination = getBackupDestination(db, id);
    if (!destination?.enabled) return false;
    return listDestinationLocations(db, id, { limit: 1 }).length > 0;
  });
}

/** Artifacts with no surviving copy anywhere — the inventory's bad news. */
export function orphanedArtifacts(db: SqliteDatabase): BackupArtifact[] {
  return listBackupArtifacts(db, { limit: 500 }).filter((artifact) => {
    const locations = db
      .prepare(
        "SELECT COUNT(*) AS n FROM backup_artifact_locations WHERE artifact_id = ? AND status = 'stored'"
      )
      .get<{ n: number }>(artifact.id);
    return Number(locations?.n ?? 0) === 0;
  });
}
