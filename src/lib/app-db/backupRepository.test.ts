import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "./connection";
import {
  DEFAULT_RETENTION,
  createBackupArtifact,
  createBackupDestination,
  createBackupPolicy,
  deleteBackupArtifact,
  deleteBackupDestination,
  getBackupArtifact,
  getBackupDestination,
  listArtifactLocations,
  listBackupArtifacts,
  listBackupDestinations,
  listDestinationLocations,
  recordArtifactLocation,
  recordArtifactVerification,
  recordDestinationOutcome,
  setArtifactPinned,
  updateBackupDestination,
  updateBackupPolicy,
} from "./backupRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-backup-db-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

function artifactInput(overrides: Record<string, unknown> = {}) {
  return {
    kind: "budget",
    checksumSha256: "a".repeat(64),
    sizeBytes: 2048,
    sourceBudgetId: "budget-1",
    sourceBudgetName: "Household",
    ...overrides,
  };
}

describe("backup destinations", () => {
  afterEach(() => resetAppDbForTests());

  it("stores a local path and an S3 bucket without holding a secret", () => {
    const { root, db } = tempDb();
    try {
      const local = createBackupDestination(db, {
        name: "NAS volume",
        kind: "local",
        config: { version: 1, data: { path: "/mnt/backups/actual" } },
      });
      const s3 = createBackupDestination(db, {
        name: "Off-site",
        kind: "s3",
        config: { version: 1, data: { bucket: "bench-backups", region: "eu-central-1", prefix: "prod/" } },
        // The credentials themselves live in the vault; this is the reference.
        credentialRef: "s3-fingerprint-1",
      });

      expect(local.kind).toBe("local");
      expect(local.config.data.path).toBe("/mnt/backups/actual");
      expect(s3.credentialRef).toBe("s3-fingerprint-1");
      expect(listBackupDestinations(db)).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to put an access key in the config", () => {
    const { root, db } = tempDb();
    try {
      expect(() =>
        createBackupDestination(db, {
          name: "Careless",
          kind: "s3",
          config: { version: 1, data: { bucket: "b", secretAccessKey: "AKIA-not-here" } },
        })
      ).toThrow(/cannot store credential field/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("remembers its own health, separately from any run that used it", () => {
    const { root, db } = tempDb();
    try {
      const destination = createBackupDestination(db, { name: "Off-site", kind: "s3" });

      recordDestinationOutcome(db, destination.id, {
        success: false,
        at: "2026-08-27T01:00:00.000Z",
        reason: "403 from bucket",
      });
      let current = getBackupDestination(db, destination.id);
      expect(current?.lastFailureReason).toBe("403 from bucket");

      recordDestinationOutcome(db, destination.id, { success: true, at: "2026-08-27T02:00:00.000Z" });
      current = getBackupDestination(db, destination.id);
      expect(current?.lastSuccessAt).toBe("2026-08-27T02:00:00.000Z");
      // A success clears the standing reason; the failure timestamp remains as
      // history rather than being erased.
      expect(current?.lastFailureReason).toBeNull();
      expect(current?.lastFailureAt).toBe("2026-08-27T01:00:00.000Z");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("updates and deletes", () => {
    const { root, db } = tempDb();
    try {
      const destination = createBackupDestination(db, { name: "Local", kind: "local" });
      const updated = updateBackupDestination(db, destination.id, { name: "Renamed", enabled: false });
      expect(updated?.name).toBe("Renamed");
      expect(updated?.enabled).toBe(false);
      expect(deleteBackupDestination(db, destination.id)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("backup policies", () => {
  afterEach(() => resetAppDbForTests());

  it("defaults to verified, unencrypted, tiered retention", () => {
    const { root, db } = tempDb();
    try {
      const policy = createBackupPolicy(db, {
        name: "Nightly",
        sourceRef: { version: 1, data: { connectionFingerprint: "srv-1" } },
        destinationIds: ["dest-1", "dest-2"],
      });

      expect(policy.contents).toBe("both");
      // Verification defaults to opening the file, not to trusting the bytes.
      expect(policy.verificationLevel).toBe("data");
      expect(policy.encryption).toBe("none");
      expect(policy.retention).toEqual(DEFAULT_RETENTION);
      expect(policy.destinationIds).toEqual(["dest-1", "dest-2"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps partial retention edits from erasing the rules not being edited", () => {
    const { root, db } = tempDb();
    try {
      const policy = createBackupPolicy(db, { name: "Nightly", retention: { daily: 30 } });
      expect(policy.retention.daily).toBe(30);
      expect(policy.retention.monthly).toBe(DEFAULT_RETENTION.monthly);
      expect(policy.retention.minimumAgeHours).toBe(DEFAULT_RETENTION.minimumAgeHours);

      const updated = updateBackupPolicy(db, policy.id, { retention: { yearly: 7 } });
      expect(updated?.retention.yearly).toBe(7);
      expect(updated?.retention.daily).toBe(DEFAULT_RETENTION.daily);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a retention rule that is not a count", () => {
    const { root, db } = tempDb();
    try {
      expect(() => createBackupPolicy(db, { name: "Bad", retention: { daily: -1 } })).toThrow(
        /must be zero or a positive integer/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores a passphrase as a vault reference, never as a passphrase", () => {
    const { root, db } = tempDb();
    try {
      const policy = createBackupPolicy(db, {
        name: "Encrypted",
        encryption: "passphrase",
        encryptionCredentialRef: "backup-passphrase-1",
      });
      expect(policy.encryption).toBe("passphrase");
      expect(policy.encryptionCredentialRef).toBe("backup-passphrase-1");

      expect(() =>
        createBackupPolicy(db, {
          name: "Careless",
          sourceRef: { version: 1, data: { passphrase: "hunter2" } },
        })
      ).toThrow(/cannot store credential field/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("artifacts and their copies", () => {
  afterEach(() => resetAppDbForTests());

  it("records one artifact stored in two destinations", () => {
    const { root, db } = tempDb();
    try {
      const local = createBackupDestination(db, { name: "Local", kind: "local" });
      const offsite = createBackupDestination(db, { name: "Off-site", kind: "s3" });
      const artifact = createBackupArtifact(db, artifactInput());

      recordArtifactLocation(db, {
        artifactId: artifact.id,
        destinationId: local.id,
        objectKey: "/mnt/backups/household-2026-08-27.zip",
        uploadedAt: "2026-08-27T02:00:00.000Z",
      });
      recordArtifactLocation(db, {
        artifactId: artifact.id,
        destinationId: offsite.id,
        objectKey: "prod/household-2026-08-27.zip",
        status: "failed",
        lastError: "timed out",
      });

      const locations = listArtifactLocations(db, artifact.id);
      expect(locations).toHaveLength(2);

      // The point of the separate table: one copy failing is not the artifact
      // failing, and each destination carries its own truth.
      const failed = locations.find((entry) => entry.destinationId === offsite.id);
      expect(failed?.status).toBe("failed");
      expect(failed?.lastError).toBe("timed out");
      expect(locations.find((entry) => entry.destinationId === local.id)?.status).toBe("stored");
      expect(listDestinationLocations(db, offsite.id)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("updates a copy on retry instead of inventing a second one", () => {
    const { root, db } = tempDb();
    try {
      const destination = createBackupDestination(db, { name: "Off-site", kind: "s3" });
      const artifact = createBackupArtifact(db, artifactInput());
      const key = "prod/household-2026-08-27.zip";

      recordArtifactLocation(db, {
        artifactId: artifact.id,
        destinationId: destination.id,
        objectKey: key,
        status: "failed",
        lastError: "timed out",
      });
      recordArtifactLocation(db, {
        artifactId: artifact.id,
        destinationId: destination.id,
        objectKey: key,
        status: "stored",
        uploadedAt: "2026-08-27T02:05:00.000Z",
      });

      const locations = listArtifactLocations(db, artifact.id);
      expect(locations).toHaveLength(1);
      expect(locations[0].status).toBe("stored");
      expect(locations[0].lastError).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is unverified until something verifies it", () => {
    const { root, db } = tempDb();
    try {
      const artifact = createBackupArtifact(db, artifactInput());
      // Bytes arriving is not verification; that distinction is the feature.
      expect(artifact.verificationStatus).toBe("unverified");
      expect(artifact.verificationLevel).toBeNull();

      const verified = recordArtifactVerification(db, artifact.id, {
        level: "data",
        status: "passed",
        at: "2026-08-27T02:01:00.000Z",
        findings: { version: 1, data: { accounts: 14, transactions: 8431, integrityCheck: "ok" } },
      });

      expect(verified?.verificationStatus).toBe("passed");
      expect(verified?.verificationLevel).toBe("data");
      expect(verified?.verification?.data.transactions).toBe(8431);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an artifact whose policy was deleted", () => {
    const { root, db } = tempDb();
    try {
      const policy = createBackupPolicy(db, { name: "Nightly" });
      const artifact = createBackupArtifact(db, artifactInput({ policyId: policy.id }));

      db.prepare("DELETE FROM backup_policies WHERE id = ?").run(policy.id);

      // The file still exists and is still restorable, which is the whole point
      // — deleting a policy must not erase the record of what it produced.
      const kept = getBackupArtifact(db, artifact.id);
      expect(kept).not.toBeNull();
      expect(kept?.policyId).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes an artifact's copies with it", () => {
    const { root, db } = tempDb();
    try {
      const destination = createBackupDestination(db, { name: "Local", kind: "local" });
      const artifact = createBackupArtifact(db, artifactInput());
      recordArtifactLocation(db, {
        artifactId: artifact.id,
        destinationId: destination.id,
        objectKey: "/mnt/backups/a.zip",
      });

      expect(deleteBackupArtifact(db, artifact.id)).toBe(true);
      expect(listArtifactLocations(db, artifact.id)).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pins and unpins, and lists newest first", () => {
    const { root, db } = tempDb();
    try {
      createBackupArtifact(db, artifactInput({ createdAt: "2026-08-25T00:00:00.000Z" }));
      const newer = createBackupArtifact(db, artifactInput({ createdAt: "2026-08-27T00:00:00.000Z" }));
      createBackupArtifact(db, artifactInput({ kind: "app-db", createdAt: "2026-08-26T00:00:00.000Z" }));

      expect(listBackupArtifacts(db)[0].id).toBe(newer.id);
      expect(listBackupArtifacts(db, { kind: "app-db" })).toHaveLength(1);

      expect(setArtifactPinned(db, newer.id, true)?.pinned).toBe(true);
      expect(setArtifactPinned(db, newer.id, false)?.pinned).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("carries encryption parameters without a key, and an automatic point's protection window", () => {
    const { root, db } = tempDb();
    try {
      const artifact = createBackupArtifact(
        db,
        artifactInput({
          encrypted: true,
          encryption: { version: 1, data: { algorithm: "aes-256-gcm", salt: "c2FsdA==", iv: "aXY=" } },
          plaintextChecksumSha256: "b".repeat(64),
          tier: "auto",
          protectedUntil: "2026-09-10T00:00:00.000Z",
          takenBefore: "Payee Cleanup apply",
        })
      );

      expect(artifact.encrypted).toBe(true);
      expect(artifact.encryption?.data.salt).toBe("c2FsdA==");
      expect(artifact.tier).toBe("auto");
      // Protected rather than pinned: exempt for a window, then prunes normally.
      expect(artifact.pinned).toBe(false);
      expect(artifact.protectedUntil).toBe("2026-09-10T00:00:00.000Z");
      expect(artifact.takenBefore).toBe("Payee Cleanup apply");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("knows the vocabulary this feature actually uses for secrets", () => {
    const { root, db } = tempDb();
    try {
      // Each of these walked past the original guard, which only knew about
      // apiKey / password / token / credential.
      for (const field of ["secretAccessKey", "passphrase", "accessKey", "privateKey"]) {
        expect(() =>
          createBackupDestination(db, {
            name: `Careless ${field}`,
            kind: "s3",
            config: { version: 1, data: { bucket: "b", [field]: "should-not-be-stored" } },
          })
        ).toThrow(/cannot store credential field/);
      }

      // And a legitimate setting is still allowed through.
      const fine = createBackupDestination(db, {
        name: "Fine",
        kind: "s3",
        config: { version: 1, data: { bucket: "b", region: "eu-central-1", pathStyle: true } },
      });
      expect(fine.config.data.region).toBe("eu-central-1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
