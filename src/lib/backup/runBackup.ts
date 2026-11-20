import { requireReadyVault } from "@/lib/credentials/vaultState";
import { openServerTransport, resolveServerConnection } from "@/lib/actual/serverTransport";
import { getBackupCredential } from "@/lib/credentials/backupSecrets";
import {
  createBackupArtifact,
  getBackupDestination,
  listBackupArtifacts,
  recordArtifactLocation,
  recordDestinationOutcome,
  type BackupArtifact,
  type BackupDestination,
  type BackupPolicy,
} from "@/lib/app-db/backupRepository";
import type { JsonEnvelope, SqliteDatabase } from "@/lib/app-db/types";
import { generateId } from "@/lib/uuid";
import type { ConnectionInstance } from "@/store/connection";
import { contentOf, detectBackupAnomalies } from "./anomaly";
import { DestinationError, openDestination } from "./destinations";
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
import { verifyAppDbArchive, verifyBudgetArchive, type VerificationOutcome } from "./verify";
import { jsonSummary } from "./verificationRecord";
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
  /**
   * The budget archive, already exported by the caller.
   *
   * Supplied for a direct connection, whose budget lives in the operator's
   * browser: the server has no way to fetch it, so the browser exports it with
   * the same official `exportBudget` call this pipeline would have made over
   * HTTP and hands the bytes over. Everything after this point - verification,
   * encryption, the manifest, every destination, retention - is unchanged and
   * unaware of where the bytes came from, which is the point: a direct copy is
   * the same artifact, not a lesser one.
   */
  budgetArchive?: { bytes: Buffer; budgetId: string | null; budgetName: string | null } | null;
  /**
   * Called immediately before the first write to a destination. Exporting and
   * verifying only read; a caller that has to report what a stop at any moment
   * means (an automation in a worker) needs to know when that changes.
   */
  onBeforeStore?: () => void;
  /** The run's deadline and cancel: honoured between steps and by every request. */
  signal?: AbortSignal;
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

function readSourceConnection(db: SqliteDatabase, policy: BackupPolicy): ConnectionInstance {
  const fingerprint = policy.sourceRef.data.connectionFingerprint;
  if (typeof fingerprint !== "string" || !fingerprint.trim()) {
    throw new Error("This backup has no source connection configured.");
  }
  requireReadyVault(db);

  let connection: ConnectionInstance | null;
  try {
    connection = resolveServerConnection(db, fingerprint);
  } catch {
    throw new Error("Bench could not decrypt the stored credentials; the vault key may have changed.");
  }
  if (!connection) {
    throw new Error(
      "The source connection is not enrolled for unattended use, so a scheduled backup cannot reach it."
    );
  }
  return connection;
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
  kind: BackupArtifactKind,
  supplied: RunBackupOptions["budgetArchive"] = null,
  signal?: AbortSignal
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

  // Already exported by the browser, for a source the server cannot reach.
  // Verified here all the same: bytes that arrived over a request deserve the
  // check more than bytes this process fetched itself, not less.
  if (supplied) {
    return {
      kind,
      label: supplied.budgetName || supplied.budgetId || "budget",
      plaintext: supplied.bytes,
      verification: verifyBudgetArchive(supplied.bytes, policy.verificationLevel),
      sourceBudgetId: supplied.budgetId,
      sourceBudgetName: supplied.budgetName,
      serverUrl: null,
    };
  }

  // Either mode, through the same transport a run uses: actual-http-api's
  // export for HTTP, Actual's own in this worker for Direct.
  const connection = readSourceConnection(db, policy);
  const transport = openServerTransport(connection);
  if (!transport.exportBudget) throw new Error("This connection cannot export its budget.");
  const exported = await transport.exportBudget({ signal });
  // A view over the exported bytes, not a copy of them.
  const bytes = Buffer.from(exported.buffer, exported.byteOffset, exported.byteLength);
  // A server that answers with nothing is a failure, not an empty backup.
  if (bytes.byteLength === 0) throw new Error("The server returned an empty export.");
  const label = connection.label && connection.label !== connection.baseUrl ? connection.label : null;
  return {
    kind,
    label: label || connection.budgetSyncId,
    plaintext: bytes,
    verification: verifyBudgetArchive(bytes, policy.verificationLevel),
    sourceBudgetId: connection.budgetSyncId,
    sourceBudgetName: label,
    serverUrl: connection.baseUrl.replace(/\/$/, ""),
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
  const signal = options.signal;

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
    signal?.throwIfAborted();
    let prepared: PreparedArtifact;
    try {
      prepared = await prepareArtifact(db, policy, kind, options.budgetArchive ?? null, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
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

    // Readable is not the same as plausible. A truncated export, or a source
    // that failed to open half its data, produces a perfectly valid archive
    // holding the wrong amount of budget — so the new copy is compared with the
    // last one before it is allowed to call itself verified.
    //
    // The last one that *passed*, of the same budget. Comparing with whatever
    // came last let a second truncated export match the first and pass, and
    // comparing across budgets (a rule whose source changed) failed copies that
    // were fine.
    const previous =
      listBackupArtifacts(db, {
        policyId: policy.id,
        kind,
        sourceBudgetId: prepared.sourceBudgetId,
        verificationStatus: "passed",
        limit: 1,
      })[0] ?? null;
    // Whether the copy read cleanly, before the comparison with the last one.
    const readable = prepared.verification.status === "passed";
    const anomalies = detectBackupAnomalies({
      content: prepared.verification.content,
      sizeBytes: prepared.plaintext.byteLength,
      kind,
      previous,
      previousContent: contentOf(previous),
    });
    if (anomalies.length > 0) {
      prepared.verification.findings.push(...anomalies);
      prepared.verification.status = "failed";
    }

    const plaintextChecksum = prepared.verification.checksumSha256;
    const encrypted = passphrase ? encryptArchive(prepared.plaintext, passphrase) : null;
    const stored = encrypted ? encrypted.bytes : prepared.plaintext;
    const verifiedAt = new Date().toISOString();

    // The row is written once a copy exists somewhere, not before: a run that
    // stored nothing used to leave a row behind that retention could never
    // remove, and every failed night added another.
    const record = {
      id: generateId(),
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
      // The artifact remembers which passphrase opens it. Deriving that from
      // the rule breaks the moment the rule is deleted — which is exactly when
      // an old encrypted copy needs to stay openable.
      encryptionCredentialRef: encrypted ? policy.encryptionCredentialRef : null,
      tier,
      pinned: false,
      protectedUntil: options.protectedUntil ?? null,
      takenBefore: options.takenBefore ?? null,
      verificationLevel: prepared.verification.level,
      verificationStatus: prepared.verification.status,
      verifiedAt,
      verification: {
        version: 1,
        data: {
          findings: prepared.verification.findings,
          // Kept apart so the page can tell "smaller than last time" (a copy
          // that opened fine and needs a human to judge) from "unreadable".
          anomalies,
          readable,
          content: jsonSummary(prepared.verification.content),
        },
      },
      manifestVersion: MANIFEST_VERSION,
      notes: options.notes ?? null,
    } satisfies Omit<BackupArtifact, "benchVersion"> & { verification: JsonEnvelope };

    const objectKey = backupObjectKey({
      kind,
      label: prepared.label,
      createdAt: now,
      artifactId: record.id,
      encrypted: encrypted !== null,
    });

    const manifest = buildManifest({ record, policy, prepared, objectKey });

    options.onBeforeStore?.();
    const results = await fanOut(db, destinations, objectKey, stored, manifest, record, signal);

    const anyStored = results.some((result) => result.status === "stored");
    artifacts.push({
      kind,
      artifactId: anyStored ? record.id : null,
      status: anyStored ? "stored" : "failed",
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

function summarize(artifacts: ArtifactOutcome[], stored: boolean, verified: boolean): string | undefined {
  const failedArtifact = artifacts.find((entry) => entry.status === "failed");
  if (failedArtifact) {
    const reason = failedArtifact.destinations.find((entry) => entry.error)?.error;
    return (
      failedArtifact.error ??
      `The ${failedArtifact.kind} backup could not be stored anywhere${reason ? `: ${reason}` : "."}`
    );
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

type ArtifactRecord = Omit<BackupArtifact, "benchVersion" | "verification"> & { verification: JsonEnvelope };

function buildManifest(input: {
  record: ArtifactRecord;
  policy: BackupPolicy;
  prepared: PreparedArtifact;
  objectKey: string;
}): BackupManifest {
  const { record, policy, prepared } = input;
  return {
    manifestVersion: MANIFEST_VERSION,
    artifactId: record.id,
    kind: record.kind,
    createdAt: record.createdAt,
    sizeBytes: record.sizeBytes,
    checksumSha256: record.checksumSha256,
    plaintextChecksumSha256: record.plaintextChecksumSha256,
    encryption: record.encrypted
      ? {
          algorithm: "aes-256-gcm",
          kdf: "scrypt",
          salt: String(record.encryption?.data.salt ?? ""),
          iv: String(record.encryption?.data.iv ?? ""),
          authTag: String(record.encryption?.data.authTag ?? ""),
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
      verifiedAt: record.verifiedAt,
      findings: prepared.verification.findings,
    },
    policy: { id: policy.id, name: policy.name },
    tier: record.tier,
    pinned: record.pinned,
    protectedUntil: record.protectedUntil,
    takenBefore: record.takenBefore,
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
  destinations: BackupDestination[],
  objectKey: string,
  bytes: Uint8Array,
  manifest: BackupManifest,
  record: ArtifactRecord,
  signal: AbortSignal | undefined
): Promise<DestinationOutcome[]> {
  const results: DestinationOutcome[] = [];
  let artifactExists = false;
  const failures: { destination: BackupDestination; message: string }[] = [];

  for (const destination of destinations) {
    signal?.throwIfAborted();
    const at = new Date().toISOString();
    try {
      const adapter = await openDestination(db, destination, { signal });
      const written = await adapter.put(
        objectKey,
        bytes,
        record.kind === "budget" && !record.encrypted ? "application/zip" : "application/octet-stream"
      );
      // The manifest goes second and only on success: a manifest without its
      // artifact would advertise a backup that is not there.
      await adapter.put(manifestKeyFor(objectKey), serializeManifest(manifest), "application/json");

      if (!artifactExists) {
        createBackupArtifact(db, record);
        artifactExists = true;
      }
      recordArtifactLocation(db, {
        artifactId: record.id,
        destinationId: destination.id,
        objectKey,
        status: "stored",
        uploadedAt: at,
        lastVerifiedAt: record.verificationStatus === "passed" ? at : null,
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
      if (signal?.aborted) throw error;
      const message =
        error instanceof DestinationError || error instanceof Error
          ? error.message
          : String(error);

      failures.push({ destination, message });
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

  // Failed uploads are recorded against the artifact only when it exists:
  // the detail is useful beside a copy that landed elsewhere, and is already
  // in the run result and the destination's health when nothing landed.
  if (artifactExists) {
    for (const failure of failures) {
      recordArtifactLocation(db, {
        artifactId: record.id,
        destinationId: failure.destination.id,
        objectKey,
        status: "failed",
        lastError: failure.message,
      });
    }
  }

  return results;
}
