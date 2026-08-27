/**
 * @jest-environment node
 */
import Database from "better-sqlite3";
import { zipSync } from "fflate";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { upsertBackupCredential } from "@/lib/app-db/backupCredentialRepository";
import {
  createBackupArtifact,
  createBackupDestination,
  createBackupPolicy,
  getBackupArtifact,
  getBackupDestination,
  listArtifactLocations,
  recordArtifactLocation,
} from "@/lib/app-db/backupRepository";
import type { BackupDestination } from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { encryptArchive } from "./encryption";
import { sha256 } from "./manifest";
import { scrubDestination } from "./scrub";

function budgetZip(): Uint8Array {
  const root = mkdtempSync(join(tmpdir(), "bench-scrub-fixture-"));
  const path = join(root, "db.sqlite");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE payees (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE transactions (id TEXT PRIMARY KEY, acct TEXT, date INTEGER, amount INTEGER);
    INSERT INTO accounts VALUES ('a1', 'Current');
  `);
  db.close();
  const bytes = readFileSync(path);
  rmSync(root, { recursive: true, force: true });
  return zipSync({
    "db.sqlite": bytes,
    "metadata.json": Buffer.from(JSON.stringify({ budgetName: "Household", id: "budget-1" })),
  });
}

describe("scrubbing a destination", () => {
  let root: string;
  let volume: string;
  let db: SqliteDatabase;
  let destination: BackupDestination;
  let policyId: string;
  const previousKey = process.env.SYNC_VAULT_KEY;

  beforeEach(() => {
    process.env.SYNC_VAULT_KEY = "test-vault-key";
    root = mkdtempSync(join(tmpdir(), "actual-bench-scrub-"));
    volume = join(root, "volume");
    mkdirSync(volume, { recursive: true });
    db = getAppDb(join(root, "metadata.sqlite"));
    destination = createBackupDestination(db, {
      name: "Volume",
      kind: "local",
      config: { version: 1, data: { path: volume } },
    });
    policyId = createBackupPolicy(db, { name: "Nightly", destinationIds: [destination.id] }).id;
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = previousKey;
  });

  function store(bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
    const artifact = createBackupArtifact(db, {
      policyId,
      kind: "budget",
      sizeBytes: bytes.byteLength,
      checksumSha256: sha256(bytes),
      verificationStatus: "passed",
      verificationLevel: "data",
      ...overrides,
    });
    const key = `budget/household/${artifact.id.slice(0, 8)}.zip`;
    mkdirSync(dirname(join(volume, key)), { recursive: true });
    writeFileSync(join(volume, key), bytes);
    recordArtifactLocation(db, {
      artifactId: artifact.id,
      destinationId: destination.id,
      objectKey: key,
      status: "stored",
      uploadedAt: new Date().toISOString(),
    });
    return { artifact, key };
  }

  it("opens the newest copy and confirms it is readable", async () => {
    const { artifact } = store(budgetZip());

    const result = await scrubDestination(db, destination);

    expect(result).toMatchObject({ checked: 1, passed: 1, failed: 0, missing: 0 });
    expect(result.artifacts[0].detail).toMatch(/Opened and read/);
    expect(listArtifactLocations(db, artifact.id)[0].lastVerifiedAt).not.toBeNull();
  });

  it("catches bytes that changed under it", async () => {
    // Bit rot does not change a file's size, so the checksum is what finds it.
    const { artifact, key } = store(budgetZip());
    const bytes = Buffer.from(readFileSync(join(volume, key)));
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    writeFileSync(join(volume, key), bytes);

    const result = await scrubDestination(db, destination);

    expect(result.failed).toBe(1);
    expect(result.artifacts[0].detail).toMatch(/bytes have changed/);
    expect(getBackupArtifact(db, artifact.id)?.verificationStatus).toBe("failed");
  });

  it("catches a truncated copy by its size before reading it", async () => {
    const { key } = store(budgetZip());
    writeFileSync(join(volume, key), readFileSync(join(volume, key)).subarray(0, 100));

    const result = await scrubDestination(db, destination);

    expect(result.failed).toBe(1);
    expect(result.artifacts[0].detail).toMatch(/Size changed/);
  });

  it("reports a copy someone deleted as missing, not as damaged", async () => {
    // The distinction matters: it decides whether to suspect retention or a disk.
    const { artifact, key } = store(budgetZip());
    rmSync(join(volume, key));

    const result = await scrubDestination(db, destination);

    expect(result).toMatchObject({ missing: 1, failed: 0 });
    expect(listArtifactLocations(db, artifact.id)[0].status).toBe("missing");
  });

  it("proves an encrypted copy is decryptable, not merely present", async () => {
    // An encrypted backup nobody can open is the most expensive kind of false
    // confidence there is.
    upsertBackupCredential(db, { ref: "pol-secret", kind: "passphrase", secret: { passphrase: "shh" } });
    const encryptedPolicy = createBackupPolicy(db, {
      name: "Off-site",
      destinationIds: [destination.id],
      encryption: "passphrase",
      encryptionCredentialRef: "pol-secret",
    });
    const { bytes } = encryptArchive(budgetZip(), "shh");
    store(bytes, { policyId: encryptedPolicy.id, encrypted: true });

    const result = await scrubDestination(db, destination);

    expect(result.passed).toBe(1);
    expect(result.artifacts[0].detail).toMatch(/Decrypted, opened and read/);
  });

  it("says so plainly when it has no passphrase to open a copy with", async () => {
    const encryptedPolicy = createBackupPolicy(db, {
      name: "Off-site",
      destinationIds: [destination.id],
      encryption: "passphrase",
    });
    const { bytes } = encryptArchive(budgetZip(), "shh");
    store(bytes, { policyId: encryptedPolicy.id, encrypted: true });

    const result = await scrubDestination(db, destination);

    // Not a failure, and not a claim that it is fine either.
    expect(result.passed).toBe(1);
    expect(result.artifacts[0].detail).toMatch(/no stored passphrase/);
  });

  it("checksums the older copies rather than opening every one", async () => {
    store(budgetZip());
    store(budgetZip());
    store(budgetZip());

    const result = await scrubDestination(db, destination, { newest: 3, deepest: 1 });

    expect(result.checked).toBe(3);
    expect(result.artifacts.filter((entry) => entry.level === "checksum")).toHaveLength(2);
    expect(result.artifacts.filter((entry) => entry.level === "deep")).toHaveLength(1);
  });

  it("records the destination's health, so a bad scrub is visible on it", async () => {
    const { key } = store(budgetZip());
    rmSync(join(volume, key));

    await scrubDestination(db, destination);

    expect(getBackupDestination(db, destination.id)?.lastFailureReason).toMatch(/missing/);
  });

  it("blames the credentials, not the copies, when it cannot reach the destination", async () => {
    const broken = createBackupDestination(db, {
      name: "Off-site",
      kind: "s3",
      credentialRef: "gone",
      config: { version: 1, data: { bucket: "bench" } },
    });

    const result = await scrubDestination(db, broken);

    expect(result.error).toMatch(/access key/i);
    expect(result.checked).toBe(0);
    expect(result.failed).toBe(0);
  });
});
