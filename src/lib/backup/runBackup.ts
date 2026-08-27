import { vaultEnabled } from "@/lib/sync/vault";
import { getSyncCredential } from "@/lib/app-db/syncCredentialRepository";
import { getBackupCredential } from "@/lib/app-db/backupCredentialRepository";
import {
  createBackupArtifact,
  getBackupDestination,
  recordArtifactLocation,
  recordDestinationOutcome,
  type BackupArtifact,
  type BackupPolicy,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase, SyncCredential } from "@/lib/app-db/types";
import { createDestinationAdapter, DestinationError } from "./destinations";
import { encryptArchive } from "./encryption";
import {
  manifestKeyFor,
  serializeManifest,
  sha256,
  MANIFEST_VERSION,
  type BackupArtifactKind,
  type BackupManifest,
  type BackupRetentionTier,
} from "./manifest";
import { exportAppDbSnapshot } from "./sources/appDbExport";
import { exportBudgetFromCredential } from "./sources/budgetExport";
import { verifyAppDbArchive, verifyBudgetArchive, type VerificationOutcome } from "./verify";
import { LATEST_SCHEMA_VERSION } from "@/lib/app-db/migrations";

/**
 * Taking a backup (RD-077 / PR-047c).
 *
 * The order of operations is the whole design, and it is not the obvious one:
 *
 *   1. **Export** from the source.
 *   2. **Verify the plaintext**, before anything else touches it. Verifying
 *      after encryption proves only that bytes survived a round trip, which is
 *      the least interesting thing that can go wrong; verifying before it means
 *      a passing artifact is one Bench has actually opened and read.
 *   3. **Encrypt**, optionally, recording parameters but never the key.
 *   4. **Fan out** to every destination independently, and record each result
 *      on its own. One destination being down must not lose the copy that did
 *      succeed elsewhere, and must not mark a healthy destination unhealthy.
 *
 * A run that verifies badly still writes its artifact and records the failure.
 * That is deliberate: a backup Bench distrusts is more useful than no backup,
 * as long as nobody is allowed to believe it is fine. Retention knows the
 * difference — an unverified copy never counts as the last good one.
 */

export type BackupRunTrigger = "scheduled" | "manual" | "safety";

export type DestinationOutcome = {
  destinationId: string;
  destinationName: string;
  status: "stored" | "failed";
  objectKey: string | null;
  sizeBytes: number | null;
  error?: string;
};

export type ArtifactOutcome = {
  kind: BackupArtifactKind;
  artifactId: string | null;
  status: "stored" | "failed";
  sizeBytes: number;
  verification: VerificationOutcome | null;
  destinations: DestinationOutcome[];
  error?: string;
};

export type BackupRunResult = {
  policyId: string | null;
  trigger: BackupRunTrigger;
  startedAt: string;
  finishedAt: string;
  artifacts: ArtifactOutcome[];
  /** True when every requested artifact reached at least one destination. */
  stored: boolean;
  /** True when every stored artifact also verified. */
  verified: boolean;
  message?: string;
};

export type RunBackupOptions = {
  trigger?: BackupRunTrigger;
  tier?: BackupRetentionTier;
  /** Recorded on the artifact: what the user was about to do. */
  takenBefore?: string | null;
  /** Protected from tier retention until this time. */
  protectedUntil?: string | null;
  notes?: string | null;
  now?: Date;
  /**
   * Narrow what this run copies, without changing the rule.
   *
   * Used by safety recovery points, which take the budget alone: they protect
   * against a change about to be made to the budget, and copying Bench's own
   * settings as well would double the wait for something the user did not ask
   * for.
   */
  contentsOverride?: BackupPolicy["contents"];
};

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "budget"
  );
}

/**
 * Object keys are deliberately human-navigable: someone browsing the
 * destination with `ls` or a bucket console should be able to find the copy
 * they want without Bench's help, because the day they are looking is the day
 * Bench is not available.
 */
export function backupObjectKey(input: {
  kind: BackupArtifactKind;
  label: string;
  createdAt: Date;
  artifactId: string;
  encrypted: boolean;
}): string {
  const iso = input.createdAt.toISOString();
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 19).replace(/:/g, "");
  const extension = input.kind === "budget" ? "zip" : "sqlite";
  const suffix = input.encrypted ? `${extension}.enc` : extension;
  return `${input.kind}/${slug(input.label)}/${day.slice(0, 4)}/${day}T${time}-${input.artifactId.slice(0, 8)}.${suffix}`;
}

type PreparedArtifact = {
  kind: BackupArtifactKind;
  label: string;
  plaintext: Buffer;
  verification: VerificationOutcome;
  sourceBudgetId: string | null;
  sourceBudgetName: string | null;
  serverUrl: string | null;
};

function readSourceCredential(db: SqliteDatabase, policy: BackupPolicy): SyncCredential {
  const fingerprint = policy.sourceRef.data.connectionFingerprint;
  if (typeof fingerprint !== "string" || !fingerprint.trim()) {
    throw new Error("This backup has no source connection configured.");
  }
  if (!vaultEnabled()) {
    throw new Error(
      "The credential vault is disabled (SYNC_VAULT_KEY is unset), so Bench cannot reach the budget without you."
    );
  }

  let credential: SyncCredential | null;
  try {
    credential = getSyncCredential(db, fingerprint);
  } catch {
    throw new Error("Bench could not decrypt the stored credentials; the vault key may have changed.");
  }
  if (!credential) {
    throw new Error(
      "The source connection is not enrolled for unattended use, so a scheduled backup cannot reach it."
    );
  }
  return credential;
}

function readPassphrase(db: SqliteDatabase, policy: BackupPolicy): string {
  if (!policy.encryptionCredentialRef) {
    throw new Error("This backup is set to encrypt but has no stored passphrase.");
  }
  const secret = getBackupCredential(db, policy.encryptionCredentialRef);
  const passphrase = secret && "passphrase" in secret ? secret.passphrase : "";
  if (!passphrase) {
    throw new Error("This backup's encryption passphrase is missing. Re-enter it to continue backing up.");
  }
  return passphrase;
}

/** Export and verify one artifact. Throws only when there is nothing to store. */
async function prepareArtifact(
  db: SqliteDatabase,
  policy: BackupPolicy,
  kind: BackupArtifactKind
): Promise<PreparedArtifact> {
  if (kind === "app-db") {
    const bytes = exportAppDbSnapshot(db);
    return {
      kind,
      label: "actual-bench",
      plaintext: bytes,
      verification: verifyAppDbArchive(bytes, policy.verificationLevel),
      sourceBudgetId: null,
      sourceBudgetName: null,
      serverUrl: null,
    };
  }

  const credential = readSourceCredential(db, policy);
  const exported = await exportBudgetFromCredential(credential);
  return {
    kind,
    label: credential.label || credential.budgetSyncId,
    plaintext: exported.bytes,
    verification: verifyBudgetArchive(exported.bytes, policy.verificationLevel),
    sourceBudgetId: credential.budgetSyncId,
    sourceBudgetName: credential.label || null,
    serverUrl: exported.serverUrl,
  };
}

function kindsFor(contents: BackupPolicy["contents"]): BackupArtifactKind[] {
  if (contents === "budget") return ["budget"];
  if (contents === "app-db") return ["app-db"];
  return ["budget", "app-db"];
}

export async function runBackup(
  db: SqliteDatabase,
  policy: BackupPolicy,
  options: RunBackupOptions = {}
): Promise<BackupRunResult> {
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();
  const trigger = options.trigger ?? "scheduled";
  const tier = options.tier ?? (trigger === "manual" ? "manual" : trigger === "safety" ? "auto" : "daily");

  const destinations = policy.destinationIds
    .map((id) => getBackupDestination(db, id))
    .filter((destination): destination is NonNullable<typeof destination> => destination !== null)
    .filter((destination) => destination.enabled);

  if (destinations.length === 0) {
    return {
      policyId: policy.id,
      trigger,
      startedAt,
      finishedAt: new Date().toISOString(),
      artifacts: [],
      stored: false,
      verified: false,
      message:
        "This backup has no enabled destination, so there is nowhere to write a copy. Add or re-enable one.",
    };
  }

  const passphrase = policy.encryption === "passphrase" ? readPassphrase(db, policy) : null;
  const artifacts: ArtifactOutcome[] = [];

  for (const kind of kindsFor(options.contentsOverride ?? policy.contents)) {
    let prepared: PreparedArtifact;
    try {
      prepared = await prepareArtifact(db, policy, kind);
    } catch (error) {
      artifacts.push({
        kind,
        artifactId: null,
        status: "failed",
        sizeBytes: 0,
        verification: null,
        destinations: [],
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const plaintextChecksum = prepared.verification.checksumSha256;
    const encrypted = passphrase ? encryptArchive(prepared.plaintext, passphrase) : null;
    const stored = encrypted ? encrypted.bytes : prepared.plaintext;

    const artifact = createBackupArtifact(db, {
      policyId: policy.id,
      kind,
      createdAt: startedAt,
      sourceBudgetId: prepared.sourceBudgetId,
      sourceBudgetName: prepared.sourceBudgetName,
      sizeBytes: stored.byteLength,
      // The checksum of the bytes as stored, which is what a later scrub can
      // actually re-compute; the plaintext checksum is recorded beside it so a
      // restore is checkable end to end.
      checksumSha256: encrypted !== null ? sha256(stored) : plaintextChecksum,
      plaintextChecksumSha256: plaintextChecksum,
      encrypted: encrypted !== null,
      encryption: encrypted ? { version: 1, data: { ...encrypted.info } } : null,
      tier,
      pinned: false,
      protectedUntil: options.protectedUntil ?? null,
      takenBefore: options.takenBefore ?? null,
      verificationLevel: prepared.verification.level,
      verificationStatus: prepared.verification.status,
      verifiedAt: new Date().toISOString(),
      verification: {
        version: 1,
        data: {
          findings: prepared.verification.findings,
          content: jsonSummary(prepared.verification.content),
        },
      },
      manifestVersion: MANIFEST_VERSION,
      notes: options.notes ?? null,
    });

    const objectKey = backupObjectKey({
      kind,
      label: prepared.label,
      createdAt: now,
      artifactId: artifact.id,
      encrypted: encrypted !== null,
    });

    const manifest = buildManifest({
      artifact,
      policy,
      prepared,
      objectKey,
      encrypted: encrypted !== null,
    });

    const results = await fanOut(db, destinations, objectKey, stored, manifest, artifact);

    artifacts.push({
      kind,
      artifactId: artifact.id,
      status: results.some((result) => result.status === "stored") ? "stored" : "failed",
      sizeBytes: stored.byteLength,
      verification: prepared.verification,
      destinations: results,
    });
  }

  const stored = artifacts.length > 0 && artifacts.every((entry) => entry.status === "stored");
  const verified =
    stored && artifacts.every((entry) => entry.verification?.status === "passed");

  return {
    policyId: policy.id,
    trigger,
    startedAt,
    finishedAt: new Date().toISOString(),
    artifacts,
    stored,
    verified,
    message: summarize(artifacts, stored, verified),
  };
}

/** Strip `undefined` so a content summary can be stored as JSON. */
function jsonSummary(content: Record<string, unknown>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(content)) {
    if (value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || value === null) out[key] = value;
  }
  return out;
}

function summarize(artifacts: ArtifactOutcome[], stored: boolean, verified: boolean): string | undefined {
  const failedArtifact = artifacts.find((entry) => entry.status === "failed");
  if (failedArtifact) {
    return failedArtifact.error ?? `The ${failedArtifact.kind} backup could not be stored anywhere.`;
  }
  if (stored && !verified) {
    const unverified = artifacts.find((entry) => entry.verification?.status !== "passed");
    return (
      unverified?.verification?.findings[0] ??
      "The copy was stored, but Bench could not confirm it is readable."
    );
  }
  const partial = artifacts.flatMap((entry) => entry.destinations).filter((entry) => entry.status === "failed");
  if (partial.length > 0) {
    return `Stored, but ${partial.length} destination${partial.length === 1 ? "" : "s"} failed: ${partial[0].error ?? "unknown error"}`;
  }
  return undefined;
}

function buildManifest(input: {
  artifact: BackupArtifact;
  policy: BackupPolicy;
  prepared: PreparedArtifact;
  objectKey: string;
  encrypted: boolean;
}): BackupManifest {
  const { artifact, policy, prepared } = input;
  return {
    manifestVersion: MANIFEST_VERSION,
    artifactId: artifact.id,
    kind: artifact.kind,
    createdAt: artifact.createdAt,
    sizeBytes: artifact.sizeBytes,
    checksumSha256: artifact.checksumSha256,
    plaintextChecksumSha256: artifact.plaintextChecksumSha256,
    encryption: input.encrypted
      ? {
          algorithm: "aes-256-gcm",
          kdf: "scrypt",
          salt: String(artifact.encryption?.data.salt ?? ""),
          iv: String(artifact.encryption?.data.iv ?? ""),
          authTag: String(artifact.encryption?.data.authTag ?? ""),
        }
      : null,
    source: {
      budgetId: prepared.sourceBudgetId,
      budgetName: prepared.sourceBudgetName,
      serverUrl: prepared.serverUrl,
    },
    content: prepared.verification.content,
    verification: {
      level: prepared.verification.level,
      status: prepared.verification.status,
      verifiedAt: artifact.verifiedAt,
      findings: prepared.verification.findings,
    },
    policy: { id: policy.id, name: policy.name },
    tier: artifact.tier,
    pinned: artifact.pinned,
    protectedUntil: artifact.protectedUntil,
    takenBefore: artifact.takenBefore,
    benchVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
    appDbSchemaVersion: LATEST_SCHEMA_VERSION,
  };
}

/**
 * Write to every destination, independently.
 *
 * Each destination gets its own try/catch and its own recorded result, because
 * "the S3 bucket was unreachable" and "the volume is full" are different
 * problems with different fixes, and collapsing them into one run-level error
 * hides which copies actually exist.
 */
async function fanOut(
  db: SqliteDatabase,
  destinations: ReturnType<typeof getBackupDestination>[],
  objectKey: string,
  bytes: Uint8Array,
  manifest: BackupManifest,
  artifact: BackupArtifact
): Promise<DestinationOutcome[]> {
  const results: DestinationOutcome[] = [];

  for (const destination of destinations) {
    if (!destination) continue;
    const at = new Date().toISOString();
    try {
      const adapter = createDestinationAdapter(db, destination);
      const written = await adapter.put(
        objectKey,
        bytes,
        artifact.kind === "budget" && !artifact.encrypted ? "application/zip" : "application/octet-stream"
      );
      // The manifest goes second and only on success: a manifest without its
      // artifact would advertise a backup that is not there.
      await adapter.put(manifestKeyFor(objectKey), serializeManifest(manifest), "application/json");

      recordArtifactLocation(db, {
        artifactId: artifact.id,
        destinationId: destination.id,
        objectKey,
        status: "stored",
        uploadedAt: at,
        lastVerifiedAt: artifact.verificationStatus === "passed" ? at : null,
      });
      recordDestinationOutcome(db, destination.id, { success: true, at });

      results.push({
        destinationId: destination.id,
        destinationName: destination.name,
        status: "stored",
        objectKey,
        sizeBytes: written.sizeBytes,
      });
    } catch (error) {
      const message =
        error instanceof DestinationError || error instanceof Error
          ? error.message
          : String(error);

      recordArtifactLocation(db, {
        artifactId: artifact.id,
        destinationId: destination.id,
        objectKey,
        status: "failed",
        lastError: message,
      });
      recordDestinationOutcome(db, destination.id, { success: false, at, reason: message });

      results.push({
        destinationId: destination.id,
        destinationName: destination.name,
        status: "failed",
        objectKey: null,
        sizeBytes: null,
        error: message,
      });
    }
  }

  return results;
}
