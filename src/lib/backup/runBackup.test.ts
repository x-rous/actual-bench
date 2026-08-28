/**
 * @jest-environment node
 */
import Database from "better-sqlite3";
import { zipSync } from "fflate";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { upsertBackupCredential } from "@/lib/app-db/backupCredentialRepository";
import {
  createBackupDestination,
  createBackupPolicy,
  getBackupDestination,
  listArtifactLocations,
  listBackupArtifacts,
} from "@/lib/app-db/backupRepository";
import { upsertSyncCredential } from "@/lib/app-db/syncCredentialRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { decryptArchive } from "./encryption";
import { parseManifest } from "./manifest";
import { backupObjectKey, runBackup } from "./runBackup";

function budgetDbBytes(): Uint8Array {
  const root = mkdtempSync(join(tmpdir(), "bench-run-fixture-"));
  const path = join(root, "db.sqlite");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE payees (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE transactions (id TEXT PRIMARY KEY, acct TEXT, date INTEGER, amount INTEGER);
    INSERT INTO accounts VALUES ('a1', 'Current');
    INSERT INTO transactions VALUES ('t1', 'a1', 20260101, -500);
  `);
  db.close();
  const bytes = readFileSync(path);
  rmSync(root, { recursive: true, force: true });
  return bytes;
}

const BUDGET_ZIP = zipSync({
  "db.sqlite": budgetDbBytes(),
  "metadata.json": Buffer.from(JSON.stringify({ budgetName: "Household", id: "budget-1" })),
});

function mockExport(bytes: Uint8Array = BUDGET_ZIP, status = 200) {
  global.fetch = jest.fn(async () =>
    status === 200
      ? new Response(Buffer.from(bytes), { status: 200 })
      : new Response(JSON.stringify({ message: "budget is locked" }), {
          status,
          headers: { "content-type": "application/json" },
        })
  ) as unknown as typeof fetch;
}

describe("running a backup", () => {
  let root: string;
  let db: SqliteDatabase;
  let volume: string;
  const previousKey = process.env.SYNC_VAULT_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.SYNC_VAULT_KEY = "test-vault-key";
    root = mkdtempSync(join(tmpdir(), "actual-bench-run-backup-"));
    volume = join(root, "volume");
    db = getAppDb(join(root, "metadata.sqlite"));

    upsertSyncCredential(db, {
      connectionFingerprint: "conn-1",
      mode: "http-api",
      baseUrl: "https://actual.example.com",
      budgetSyncId: "budget-1",
      label: "Household",
      secret: { apiKey: "key", encryptionPassword: "" },
    });
    mockExport();
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = previousKey;
  });

  function localDestination(name = "Volume", path = volume) {
    return createBackupDestination(db, {
      name,
      kind: "local",
      config: { version: 1, data: { path } },
    });
  }

  function policy(overrides: Record<string, unknown> = {}) {
    return createBackupPolicy(db, {
      name: "Nightly",
      contents: "budget",
      sourceRef: { version: 1, data: { connectionFingerprint: "conn-1" } },
      destinationIds: [localDestination().id],
      verificationLevel: "data",
      ...overrides,
    });
  }

  it("stores a verified copy and a manifest beside it", async () => {
    const result = await runBackup(db, policy());

    expect(result.stored).toBe(true);
    expect(result.verified).toBe(true);

    const [artifact] = listBackupArtifacts(db);
    expect(artifact.verificationStatus).toBe("passed");
    expect(artifact.kind).toBe("budget");

    const [location] = listArtifactLocations(db, artifact.id);
    expect(location.status).toBe("stored");

    const stored = readFileSync(join(volume, location.objectKey));
    expect(stored.byteLength).toBe(artifact.sizeBytes);

    const manifest = parseManifest(readFileSync(join(volume, `${location.objectKey}.manifest.json`)));
    expect(manifest?.artifactId).toBe(artifact.id);
    expect(manifest?.content?.transactions).toBe(1);
    expect(manifest?.source?.budgetName).toBe("Household");
  });

  it("keeps the copy that succeeded when another destination fails", async () => {
    // The reason locations are their own table: one bad destination must not
    // lose the copy that did land, or make the healthy one look broken.
    const good = localDestination("Volume", join(root, "good"));
    const bad = createBackupDestination(db, {
      name: "Broken",
      kind: "s3",
      credentialRef: "missing",
      config: { version: 1, data: { bucket: "nope" } },
    });

    const result = await runBackup(
      db,
      policy({ destinationIds: [good.id, bad.id] })
    );

    expect(result.stored).toBe(true);
    const outcomes = result.artifacts[0].destinations;
    expect(outcomes.find((entry) => entry.destinationId === good.id)?.status).toBe("stored");
    expect(outcomes.find((entry) => entry.destinationId === bad.id)?.status).toBe("failed");

    expect(getBackupDestination(db, good.id)?.lastSuccessAt).not.toBeNull();
    expect(getBackupDestination(db, good.id)?.lastFailureReason).toBeNull();
    expect(getBackupDestination(db, bad.id)?.lastFailureReason).toMatch(/access key/i);
  });

  it("verifies the plaintext, not the ciphertext", async () => {
    upsertBackupCredential(db, {
      ref: "pol-secret",
      kind: "passphrase",
      secret: { passphrase: "correct horse" },
    });

    const result = await runBackup(
      db,
      policy({ encryption: "passphrase", encryptionCredentialRef: "pol-secret" })
    );

    // Encrypted bytes are not a readable ZIP; the run still verifies, because
    // verification happened before encryption.
    expect(result.verified).toBe(true);

    const [artifact] = listBackupArtifacts(db);
    expect(artifact.encrypted).toBe(true);
    expect(artifact.plaintextChecksumSha256).not.toBe(artifact.checksumSha256);

    const [location] = listArtifactLocations(db, artifact.id);
    expect(location.objectKey.endsWith(".zip.enc")).toBe(true);

    const stored = readFileSync(join(volume, location.objectKey));
    expect(decryptArchive(stored, "correct horse").byteLength).toBe(BUDGET_ZIP.byteLength);
  });

  it("records a stored-but-unverified copy rather than throwing it away", async () => {
    // A backup Bench distrusts beats no backup, as long as nobody is allowed to
    // believe it is fine.
    mockExport(zipSync({ "readme.txt": Buffer.from("not a budget") }));

    const result = await runBackup(db, policy());

    expect(result.stored).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.message).toMatch(/db\.sqlite/);
    expect(listBackupArtifacts(db)[0].verificationStatus).toBe("failed");
  });

  it("says what went wrong when the export itself fails", async () => {
    mockExport(BUDGET_ZIP, 423);

    const result = await runBackup(db, policy());

    expect(result.stored).toBe(false);
    expect(result.message).toMatch(/budget is locked/);
    expect(listBackupArtifacts(db)).toHaveLength(0);
  });

  it("refuses to run with nowhere to write instead of reporting success", async () => {
    const result = await runBackup(db, policy({ destinationIds: [] }));

    expect(result.stored).toBe(false);
    expect(result.message).toMatch(/nowhere to write/);
  });

  it("backs up Bench's own database as a second artifact", async () => {
    const result = await runBackup(db, policy({ contents: "both" }));

    expect(result.artifacts.map((entry) => entry.kind)).toEqual(["budget", "app-db"]);
    expect(result.stored).toBe(true);

    const appDb = listBackupArtifacts(db).find((entry) => entry.kind === "app-db");
    expect(appDb?.verificationStatus).toBe("passed");

    const [location] = listArtifactLocations(db, appDb!.id);
    // A consistent copy, openable on its own.
    const copy = new Database(join(volume, location.objectKey), { readonly: true });
    expect(copy.prepare("SELECT COUNT(*) AS n FROM backup_policies").get<{ n: number }>()?.n).toBe(1);
    copy.close();
  });

  it("names objects so a human can find them without Bench", async () => {
    const key = backupObjectKey({
      kind: "budget",
      label: "Household Budget",
      createdAt: new Date("2026-08-27T04:05:06Z"),
      artifactId: "abcdef123456",
      encrypted: false,
    });

    expect(key).toBe("budget/household-budget/2026/2026-08-27T040506-abcdef12.zip");
  });

  it("leaves no manifest behind for an artifact that failed to upload", async () => {
    // A manifest without its artifact would advertise a backup that is not there.
    const readOnly = join(root, "read-only");
    const destination = localDestination("Locked", readOnly);
    // Replace the destination directory with a file, so every write fails.
    rmSync(readOnly, { recursive: true, force: true });
    writeFileSync(readOnly, "x");

    const result = await runBackup(db, policy({ destinationIds: [destination.id] }));

    expect(result.stored).toBe(false);
    expect(statSync(readOnly).isFile()).toBe(true);
  });

  it("writes nothing outside the destination root", async () => {
    await runBackup(db, policy());
    // Everything under the volume, nothing beside it (bar SQLite's own WAL
    // sidecars for the metadata database).
    const strays = readdirSync(root).filter((entry) => !entry.startsWith("metadata.sqlite"));
    expect(strays).toEqual(["volume"]);
  });
});
