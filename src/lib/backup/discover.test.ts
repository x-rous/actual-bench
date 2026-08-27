/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import {
  createBackupDestination,
  createBackupPolicy,
  getBackupArtifact,
  listArtifactLocations,
  listBackupArtifacts,
} from "@/lib/app-db/backupRepository";
import { upsertSyncCredential } from "@/lib/app-db/syncCredentialRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { discoverBackups } from "./discover";
import { runBackup } from "./runBackup";
import { buildBudgetArchive } from "./testFixtures";

/**
 * Rebuilding the inventory from nothing but what is in the destination.
 *
 * This is the claim the whole manifest design exists to support: lose Bench's
 * database entirely — the server died, the volume was recreated — and the
 * backups are still yours. The test earns it the only way that means anything,
 * by throwing the database away and starting again with an empty one.
 */
describe("finding backups in a destination", () => {
  let root: string;
  let volume: string;
  let db: SqliteDatabase;
  const previousKey = process.env.SYNC_VAULT_KEY;
  const previousDbPath = process.env.ACTUAL_BENCH_DB_PATH;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.SYNC_VAULT_KEY = "test-vault-key";
    root = mkdtempSync(join(tmpdir(), "actual-bench-discover-"));
    volume = join(root, "volume");
    mkdirSync(volume, { recursive: true });
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    db = getAppDb();
    global.fetch = jest.fn(
      async () => new Response(Buffer.from(buildBudgetArchive({ transactions: 4 })), { status: 200 })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = previousKey;
    if (previousDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = previousDbPath;
  });

  function destination() {
    return createBackupDestination(db, {
      name: "Volume",
      kind: "local",
      config: { version: 1, data: { path: volume } },
    });
  }

  async function takeRealBackup() {
    upsertSyncCredential(db, {
      connectionFingerprint: "conn-1",
      mode: "http-api",
      baseUrl: "https://actual.example.com",
      budgetSyncId: "budget-1",
      label: "Household",
      secret: { apiKey: "key", encryptionPassword: "" },
    });
    const target = destination();
    const policy = createBackupPolicy(db, {
      name: "Nightly",
      contents: "budget",
      destinationIds: [target.id],
      sourceRef: { version: 1, data: { connectionFingerprint: "conn-1" } },
    });
    const result = await runBackup(db, policy, { trigger: "manual" });
    expect(result.stored).toBe(true);
    return listBackupArtifacts(db)[0];
  }

  it("rebuilds the inventory against a database that knows nothing", async () => {
    const original = await takeRealBackup();

    // Throw the database away, exactly as losing the server would.
    resetAppDbForTests();
    rmSync(join(root, "metadata.sqlite"), { force: true });
    rmSync(join(root, "metadata.sqlite-wal"), { force: true });
    rmSync(join(root, "metadata.sqlite-shm"), { force: true });
    db = getAppDb();
    expect(listBackupArtifacts(db)).toHaveLength(0);

    const result = await discoverBackups(db, destination());

    expect(result).toMatchObject({ imported: 1, alreadyKnown: 0, unreadable: 0 });

    const recovered = getBackupArtifact(db, original.id);
    expect(recovered).toMatchObject({
      id: original.id,
      kind: "budget",
      sourceBudgetName: "Household",
      checksumSha256: original.checksumSha256,
      sizeBytes: original.sizeBytes,
      // Verification state travels with the artifact, not with the database.
      verificationStatus: "passed",
      tier: "manual",
    });
    // And it knows where the file is, so it can be downloaded or verified.
    expect(listArtifactLocations(db, original.id)[0]?.status).toBe("stored");
  });

  it("adds without overwriting what Bench already knows", async () => {
    await takeRealBackup();
    const first = await discoverBackups(db, destination());
    const second = await discoverBackups(db, destination());

    expect(first.imported).toBe(0);
    expect(first.alreadyKnown).toBe(1);
    expect(second.alreadyKnown).toBe(1);
    expect(listBackupArtifacts(db)).toHaveLength(1);
  });

  it("refuses to list a backup whose file is gone, however good its manifest", async () => {
    const original = await takeRealBackup();
    const location = listArtifactLocations(db, original.id)[0];

    // The archive disappears; its manifest stays behind.
    rmSync(join(volume, location.objectKey));
    resetAppDbForTests();
    rmSync(join(root, "metadata.sqlite"), { force: true });
    db = getAppDb();

    const result = await discoverBackups(db, destination());

    expect(result.imported).toBe(0);
    expect(result.unreadable).toBe(1);
    expect(result.notes[0]).toMatch(/described by a manifest but is not present/);
    expect(listBackupArtifacts(db)).toHaveLength(0);
  });

  it("says plainly when a destination holds files it cannot identify", async () => {
    const target = destination();
    mkdirSync(dirname(join(volume, "stray/backup.zip")), { recursive: true });
    writeFileSync(join(volume, "stray/backup.zip"), "not written by Bench");

    const result = await discoverBackups(db, target);

    expect(result.imported).toBe(0);
    expect(result.notes[0]).toMatch(/none have a Bench manifest beside them/);
  });

  it("reads a manifest written by a newer version for what it does carry", async () => {
    const original = await takeRealBackup();
    const location = listArtifactLocations(db, original.id)[0];
    const manifestPath = join(volume, `${location.objectKey}.manifest.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

    writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, manifestVersion: 99, tier: "fortnightly", somethingNew: true })
    );
    resetAppDbForTests();
    rmSync(join(root, "metadata.sqlite"), { force: true });
    db = getAppDb();

    const result = await discoverBackups(db, destination());

    expect(result.imported).toBe(1);
    // An unfamiliar tier is treated as manual: keeping a backup Bench does not
    // understand beats pruning it.
    expect(getBackupArtifact(db, original.id)?.tier).toBe("manual");
  });
});
