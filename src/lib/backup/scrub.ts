import { getBackupCredential } from "@/lib/credentials/backupSecrets";
import {
  getBackupArtifact,
  getBackupDestination,
  listArtifactLocations,
  listDestinationLocations,
  recordArtifactLocation,
  recordDestinationOutcome,
  type BackupArtifact,
  type BackupArtifactLocation,
  type BackupDestination,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { openDestination, type DestinationAdapter } from "./destinations";
import { decryptArchive } from "./encryption";
import { sha256, type BackupVerificationLevel } from "./manifest";
import { verifyAppDbArchive, verifyBudgetArchive } from "./verify";
import { recordReadOutcome } from "./verificationRecord";

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
  /**
   * `skipped` is not a lesser pass: it means Bench could not open the copy and
   * therefore cannot say whether it is good. Reporting that as verified is how
   * a lost passphrase stays invisible until the day it matters.
   */
  status: "passed" | "failed" | "missing" | "skipped";
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
  /** Present and unchanged, but not opened - so not verified. */
  skipped: number;
  artifacts: ScrubArtifactResult[];
  error?: string;
};

export type ScrubOptions = {
  /**
   * How many further copies to checksum per destination, chosen by which
   * were verified longest ago. Rotating through them means every copy - the
   * monthly and yearly ones included - is re-read over successive scrubs.
   */
  newest?: number;
  /** Zero checks by checksum only; otherwise the newest copy of each rule and budget is opened. */
  deepest?: number;
  now?: Date;
  signal?: AbortSignal;
};

/** Copies recorded missing that a scrub looks for again (a remounted volume brings them back). */
const MISSING_RECHECK_LIMIT = 50;

/**
 * Is this artifact still good somewhere other than here?
 *
 * Verification status lives on the artifact, but a scrub only ever looks at one
 * destination. Marking the artifact failed because this copy is damaged would
 * contradict the rule the whole design rests on - destinations fail
 * independently - and would strip the "newest verified copy" protection from an
 * artifact that is sitting intact in another bucket.
 */
function intactElsewhere(
  db: SqliteDatabase,
  artifactId: string,
  thisDestinationId: string
): boolean {
  return listArtifactLocations(db, artifactId).some(
    (location) => location.destinationId !== thisDestinationId && location.status === "stored"
  );
}

function passphraseFor(db: SqliteDatabase, artifact: BackupArtifact): string | null {
  if (!artifact.encrypted) return null;
  // Only the artifact's own reference. Falling back to its rule's current
  // passphrase is wrong once a rule's passphrase can change: the rule's
  // current one cannot open an older copy, and trying marked good copies as
  // damaged. A copy with no reference of its own (found by discovery) is
  // opened with a typed passphrase instead.
  const ref = artifact.encryptionCredentialRef;
  if (!ref) return null;
  try {
    const secret = getBackupCredential(db, ref);
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
    skipped: 0,
    artifacts: [],
  };

  let adapter: DestinationAdapter;
  try {
    // Checks the folder is the one Bench has been writing to before anything
    // is called missing: an unmounted volume is an empty directory, and
    // scrubbing it used to mark every real copy gone.
    adapter = await openDestination(db, destination, { signal: options.signal });
  } catch (error) {
    options.signal?.throwIfAborted();
    result.error = error instanceof Error ? error.message : String(error);
    recordDestinationOutcome(db, destination.id, { success: false, at, reason: result.error });
    return result;
  }
  await adapter.sweepPartials?.().catch(() => 0);

  const locations = chooseLocations(db, destination.id, { rolling: newest, open: deepest > 0 });

  for (const { location, open } of locations) {
    // Thrown, not a quiet stop: a cancelled check is not a finished one.
    options.signal?.throwIfAborted();
    const artifact = getBackupArtifact(db, location.artifactId);
    if (!artifact) continue;
    result.checked += 1;

    try {
      const head = await adapter.head(location.objectKey);
      if (!head && location.status === "missing") {
        // Still gone. Its check is recorded, so the next scrub looks at the
        // missing copies checked longest ago, not the same newest ones.
        recordArtifactLocation(db, {
          artifactId: artifact.id,
          destinationId: destination.id,
          objectKey: location.objectKey,
          status: "missing",
          lastError: location.lastError ?? "The object is no longer in this destination.",
        });
        result.missing += 1;
        result.artifacts.push({
          artifactId: artifact.id,
          objectKey: location.objectKey,
          status: "missing",
          level: "checksum",
          detail: "Still missing from this destination.",
        });
        continue;
      }
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
        recordArtifactLocation(db, {
          artifactId: artifact.id,
          destinationId: destination.id,
          objectKey: location.objectKey,
          status: "failed",
          lastError: `Stored size ${head.sizeBytes} does not match the recorded ${artifact.sizeBytes} bytes.`,
        });
        if (!intactElsewhere(db, artifact.id, destination.id)) {
          recordReadOutcome(
            db,
            artifact,
            {
              level: artifact.verificationLevel ?? "archive",
              status: "failed",
              findings: [`Stored size ${head.sizeBytes} does not match the recorded ${artifact.sizeBytes} bytes.`],
            },
            at
          );
        }
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
        recordArtifactLocation(db, {
          artifactId: artifact.id,
          destinationId: destination.id,
          objectKey: location.objectKey,
          status: "failed",
          lastError: "The stored bytes no longer match the checksum recorded when written.",
        });
        if (!intactElsewhere(db, artifact.id, destination.id)) {
          recordReadOutcome(
            db,
            artifact,
            {
              level: artifact.verificationLevel ?? "archive",
              status: "failed",
              findings: ["The stored bytes no longer match the checksum recorded when written."],
            },
            at
          );
        }
        result.artifacts.push({
          artifactId: artifact.id,
          objectKey: location.objectKey,
          status: "failed",
          level: "checksum",
          detail: "The bytes have changed since they were written.",
        });
        continue;
      }

      // Only the newest copy of each rule is opened; the rest are proved intact
      // by checksum, which is what actually detects rot.
      if (!open) {
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
          // Not a failure, and emphatically not a pass: Bench cannot open it,
          // so it cannot say whether it is good. Counting this as verified -
          // and stamping lastVerifiedAt - would let a lost passphrase look like
          // a healthy backup right up until someone needed it.
          result.skipped += 1;
          result.artifacts.push({
            artifactId: artifact.id,
            objectKey: location.objectKey,
            status: "skipped",
            level: "checksum",
            detail:
              "Present and unchanged, but Bench has no stored passphrase for it, so its contents were not checked.",
          });
          continue;
        }
        plaintext = decryptArchive(bytes, passphrase);
      }

      const outcome =
        artifact.kind === "budget"
          ? verifyBudgetArchive(plaintext, "deep")
          : verifyAppDbArchive(plaintext, "data");

      if (outcome.status === "passed" || !intactElsewhere(db, artifact.id, destination.id)) {
        recordReadOutcome(db, artifact, outcome, at);
      }
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
      // A read the run stopped is not damage: nothing is recorded for it.
      options.signal?.throwIfAborted();
      result.failed += 1;
      const message = error instanceof Error ? error.message : String(error);

      // A copy that threw on the way to being read is a copy Bench could not
      // read. Leaving the artifact's verification alone would keep it counted
      // as the newest verified copy - the one retention refuses to delete -
      // while nobody can actually open it. The location stays `stored`: the
      // file is still there, it is the reading of it that failed.
      recordArtifactLocation(db, {
        artifactId: artifact.id,
        destinationId: destination.id,
        objectKey: location.objectKey,
        status: "stored",
        lastError: message,
      });
      if (!intactElsewhere(db, artifact.id, destination.id)) {
        recordReadOutcome(
          db,
          artifact,
          { level: artifact.verificationLevel ?? "archive", status: "failed", findings: [message] },
          at
        );
      }

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
    options.signal?.throwIfAborted();
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
  // Every artifact, in one query: a capped list missed the oldest ones.
  const ids = db
    .prepare(
      `SELECT a.id AS id FROM backup_artifacts a
        WHERE NOT EXISTS (
          SELECT 1 FROM backup_artifact_locations l WHERE l.artifact_id = a.id AND l.status = 'stored'
        )
        ORDER BY a.created_at DESC`
    )
    .all<{ id: string }>()
    .map((row) => row.id);
  return ids.map((id) => getBackupArtifact(db, id)).filter((artifact): artifact is BackupArtifact => artifact !== null);
}

type LocationRow = {
  id: string;
  artifact_id: string;
  object_key: string;
  status: string;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
  policy_id: string | null;
  kind: string;
  source_budget_id: string | null;
};

/**
 * Which copies in a destination this scrub looks at, and which it opens.
 *
 *   * The newest copy of each rule, kind and budget is **opened** - one rule's
 *     copies can no longer crowd another's out of the check.
 *   * Then `rolling` more are **checksummed** (on top of those opened), the ones verified longest ago
 *     first, so over successive scrubs every copy is re-read - including the
 *     old monthly and yearly ones, which are the long-term history and were
 *     never looked at again.
 *   * Copies recorded **missing** are looked for again: a volume that comes
 *     back brings them back.
 */
function chooseLocations(
  db: SqliteDatabase,
  destinationId: string,
  input: { rolling: number; open: boolean }
): { location: BackupArtifactLocation; open: boolean }[] {
  const rows = db
    .prepare(
      `SELECT l.id, l.artifact_id, l.object_key, l.status, l.last_verified_at, l.created_at, l.updated_at,
              a.policy_id, a.kind, a.source_budget_id
         FROM backup_artifact_locations l
         JOIN backup_artifacts a ON a.id = l.artifact_id
        WHERE l.destination_id = ? AND l.status IN ('stored', 'missing')
        ORDER BY a.created_at DESC`
    )
    .all<LocationRow>(destinationId);

  const chosen: { id: string; open: boolean }[] = [];
  const taken = new Set<string>();
  const seenGroups = new Set<string>();

  for (const row of rows) {
    if (row.status !== "stored") continue;
    const group = `${row.policy_id ?? ""}::${row.kind}::${row.source_budget_id ?? ""}`;
    if (seenGroups.has(group)) continue;
    seenGroups.add(group);
    chosen.push({ id: row.id, open: input.open });
    taken.add(row.id);
  }

  const rolling = rows
    .filter((row) => row.status === "stored" && !taken.has(row.id))
    .sort((a, b) => (a.last_verified_at ?? "").localeCompare(b.last_verified_at ?? ""))
    .slice(0, Math.max(0, input.rolling));
  for (const row of rolling) {
    chosen.push({ id: row.id, open: false });
    taken.add(row.id);
  }

  // Checked longest ago first: a fixed newest 50 would never reach a 51st
  // missing copy that came back.
  const missing = rows
    .filter((entry) => entry.status === "missing")
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .slice(0, MISSING_RECHECK_LIMIT);
  for (const row of missing) {
    chosen.push({ id: row.id, open: false });
  }

  const byId = new Map(
    listDestinationLocations(db, destinationId, { limit: "all" }).map((location) => [location.id, location])
  );
  return chosen
    .map((entry) => ({ location: byId.get(entry.id), open: entry.open }))
    .filter((entry): entry is { location: BackupArtifactLocation; open: boolean } => entry.location !== undefined);
}
