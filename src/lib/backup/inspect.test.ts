/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import {
  createBackupArtifact,
  createBackupDestination,
  createBackupPolicy,
  recordArtifactLocation,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { inspectArtifact, readableLocations } from "./inspect";
import { sha256 } from "./manifest";
import { buildBudgetArchive } from "./testFixtures";

describe("looking inside a backup", () => {
  let root: string;
  let db: SqliteDatabase;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-inspect-"));
    db = getAppDb(join(root, "metadata.sqlite"));
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
  });

  function storedTwice(bytes: Uint8Array) {
    const destinations = ["first", "second"].map((name) => {
      const path = join(root, name);
      mkdirSync(path, { recursive: true });
      return createBackupDestination(db, { name, kind: "local", config: { version: 1, data: { path } } });
    });
    const policy = createBackupPolicy(db, { name: "Nightly", destinationIds: destinations.map((entry) => entry.id) });
    const artifact = createBackupArtifact(db, {
      policyId: policy.id,
      kind: "budget",
      sizeBytes: bytes.byteLength,
      checksumSha256: sha256(bytes),
      verificationStatus: "passed",
    });
    const key = `budget/household/${artifact.id.slice(0, 8)}.zip`;
    for (const destination of destinations) {
      const path = join(root, destination.name, key);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      recordArtifactLocation(db, {
        artifactId: artifact.id,
        destinationId: destination.id,
        objectKey: key,
        status: "stored",
        uploadedAt: new Date().toISOString(),
      });
    }
    return { artifact, key };
  }

  it("opens an intact copy when the first one it reads is damaged", async () => {
    const bytes = buildBudgetArchive();
    const { artifact, key } = storedTwice(bytes);
    const [first, second] = readableLocations(db, artifact.id);
    const damaged = Buffer.from(bytes);
    damaged[Math.floor(damaged.length / 2)] ^= 0xff;
    writeFileSync(join(root, first.destination.name, key), damaged);

    const result = await inspectArtifact(db, artifact.id);

    expect(result.checksumMatches).toBe(true);
    expect(result.opened).toBe(true);
    expect(result.destinationName).toBe(second.destination.name);
  });

  it("calls it damaged only when every copy is", async () => {
    const bytes = buildBudgetArchive();
    const { artifact, key } = storedTwice(bytes);
    const damaged = Buffer.from(bytes);
    damaged[Math.floor(damaged.length / 2)] ^= 0xff;
    for (const name of ["first", "second"]) writeFileSync(join(root, name, key), damaged);

    const result = await inspectArtifact(db, artifact.id);

    expect(result.checksumMatches).toBe(false);
    expect(result.opened).toBe(false);
  });
});
