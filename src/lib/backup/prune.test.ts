/**
 * @jest-environment node
 */
import { mkdtempSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import {
  DEFAULT_RETENTION,
  createBackupArtifact,
  createBackupDestination,
  createBackupPolicy,
  getBackupArtifact,
  listArtifactLocations,
  recordArtifactLocation,
  type BackupArtifact,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { prune, previewPrune } from "./prune";

describe("carrying out a retention plan", () => {
  let root: string;
  let volume: string;
  let db: SqliteDatabase;
  let destinationId: string;
  let policyId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-prune-"));
    volume = join(root, "volume");
    mkdirSync(volume, { recursive: true });
    db = getAppDb(join(root, "metadata.sqlite"));
    destinationId = createBackupDestination(db, {
      name: "Volume",
      kind: "local",
      config: { version: 1, data: { path: volume } },
    }).id;
    policyId = createBackupPolicy(db, {
      name: "Nightly",
      destinationIds: [destinationId],
      sourceRef: { version: 1, data: { connectionFingerprint: "conn-1" } },
    }).id;
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  function storedArtifact(createdAt: string, overrides: Record<string, unknown> = {}): BackupArtifact {
    const artifact = createBackupArtifact(db, {
      policyId,
      kind: "budget",
      createdAt,
      checksumSha256: "a".repeat(64),
      sizeBytes: 10,
      tier: "daily",
      verificationStatus: "passed",
      verificationLevel: "data",
      ...overrides,
    });
    const key = `budget/household/${createdAt.slice(0, 10)}-${artifact.id.slice(0, 6)}.zip`;
    mkdirSync(dirname(join(volume, key)), { recursive: true });
    writeFileSync(join(volume, key), "backup bytes");
    writeFileSync(join(volume, `${key}.manifest.json`), "{}");
    recordArtifactLocation(db, {
      artifactId: artifact.id,
      destinationId,
      objectKey: key,
      status: "stored",
      uploadedAt: createdAt,
    });
    return artifact;
  }

  const retention = { ...DEFAULT_RETENTION, daily: 1, weekly: 0, monthly: 0, yearly: 0, minimumAgeHours: 0 };
  const now = new Date("2026-08-27T12:00:00.000Z");

  it("deletes the artifact, its manifest and its row together", async () => {
    const keep = storedArtifact("2026-08-27T02:00:00.000Z");
    const drop = storedArtifact("2026-08-20T02:00:00.000Z");

    const result = await prune(db, { artifacts: [keep, drop], retention, now });

    expect(result.pruned.map((entry) => entry.artifactId)).toEqual([drop.id]);
    expect(getBackupArtifact(db, drop.id)).toBeNull();
    expect(getBackupArtifact(db, keep.id)).not.toBeNull();

    const droppedKey = `budget/household/2026-08-20-${drop.id.slice(0, 6)}.zip`;
    expect(existsSync(join(volume, droppedKey))).toBe(false);
    expect(existsSync(join(volume, `${droppedKey}.manifest.json`))).toBe(false);
  });

  it("previews without touching anything", () => {
    const keep = storedArtifact("2026-08-27T02:00:00.000Z");
    const drop = storedArtifact("2026-08-20T02:00:00.000Z");

    const preview = previewPrune(db, { artifacts: [keep, drop], retention, now });

    expect(preview.dryRun).toBe(true);
    expect(preview.pruned).toHaveLength(1);
    expect(preview.freedBytes).toBe(10);
    expect(preview.pruned[0].reason).toBeTruthy();
    // Nothing removed.
    expect(getBackupArtifact(db, drop.id)).not.toBeNull();
    expect(listArtifactLocations(db, drop.id)[0].status).toBe("stored");
  });

  it("keeps the row when the copy could not be deleted", async () => {
    // Removing Bench's record of a file that is still sitting in a destination
    // would turn a transient error into an orphan nobody knows about.
    const keep = storedArtifact("2026-08-27T02:00:00.000Z");
    const drop = storedArtifact("2026-08-20T02:00:00.000Z");

    const broken = createBackupDestination(db, {
      name: "Unreachable",
      kind: "s3",
      credentialRef: "missing",
      config: { version: 1, data: { bucket: "gone" } },
    });
    recordArtifactLocation(db, {
      artifactId: drop.id,
      destinationId: broken.id,
      objectKey: "budget/household/copy.zip",
      status: "stored",
    });

    const result = await prune(db, { artifacts: [keep, drop], retention, now });

    expect(result.failed).toBe(1);
    expect(result.pruned[0].removed).toBe(false);
    expect(getBackupArtifact(db, drop.id)).not.toBeNull();
    // The copy that could be deleted still was.
    expect(
      listArtifactLocations(db, drop.id).find((entry) => entry.destinationId === destinationId)?.status
    ).toBe("deleted");
  });

  it("does nothing when the plan keeps everything", async () => {
    const only = storedArtifact("2026-08-27T02:00:00.000Z");
    const result = await prune(db, { artifacts: [only], retention, now });

    expect(result.pruned).toEqual([]);
    expect(result.freedBytes).toBe(0);
    expect(getBackupArtifact(db, only.id)).not.toBeNull();
  });
});
