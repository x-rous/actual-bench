/**
 * @jest-environment node
 */
import { zipSync } from "fflate";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import {
  createBackupDestination,
  createBackupPolicy,
  listBackupArtifacts,
} from "@/lib/app-db/backupRepository";
import { upsertSyncCredential } from "@/lib/app-db/syncCredentialRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { readSafetySettings, takeSafetyRecoveryPoint, writeSafetySettings } from "./safetyPoint";

function budgetZip(): Uint8Array {
  const root = mkdtempSync(join(tmpdir(), "bench-safety-fixture-"));
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
  return zipSync({ "db.sqlite": bytes, "metadata.json": Buffer.from("{}") });
}

describe("recovery points before risky changes", () => {
  let root: string;
  let db: SqliteDatabase;
  const previousKey = process.env.SYNC_VAULT_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.SYNC_VAULT_KEY = "test-vault-key";
    root = mkdtempSync(join(tmpdir(), "actual-bench-safety-"));
    mkdirSync(join(root, "volume"), { recursive: true });
    db = getAppDb(join(root, "metadata.sqlite"));
    global.fetch = jest.fn(async () => new Response(Buffer.from(budgetZip()), { status: 200 })) as
      unknown as typeof fetch;
  });

  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = previousKey;
  });

  function setUpPolicy(options: { safetyPoints?: boolean } = {}) {
    // Off by default, so every test that expects a recovery point has to ask
    // for one - which is the behaviour under test.
    if (options.safetyPoints !== false) writeSafetySettings(db, { enabled: true });
    upsertSyncCredential(db, {
      connectionFingerprint: "conn-1",
      mode: "http-api",
      baseUrl: "https://actual.example.com",
      budgetSyncId: "budget-1",
      label: "Household",
      secret: { apiKey: "key", encryptionPassword: "" },
    });
    const destination = createBackupDestination(db, {
      name: "Volume",
      kind: "local",
      config: { version: 1, data: { path: join(root, "volume") } },
    });
    return createBackupPolicy(db, {
      name: "Nightly",
      contents: "both",
      destinationIds: [destination.id],
      sourceRef: { version: 1, data: { connectionFingerprint: "conn-1" } },
    });
  }

  it("takes a protected copy that expires rather than a permanent pin", async () => {
    // A recovery point taken automatically must not accumulate forever — that
    // is the failure mode of every "safety snapshot" that never cleans up.
    setUpPolicy();

    const outcome = await takeSafetyRecoveryPoint(db, { reason: "merging 40 payees" });

    expect(outcome.status).toBe("taken");
    const [artifact] = listBackupArtifacts(db);
    expect(artifact.tier).toBe("auto");
    expect(artifact.pinned).toBe(false);
    expect(artifact.protectedUntil).not.toBeNull();
    expect(artifact.takenBefore).toBe("merging 40 payees");
  });

  it("copies only the budget, so the user is not kept waiting for settings too", async () => {
    setUpPolicy();
    await takeSafetyRecoveryPoint(db, { reason: "a bulk edit" });

    expect(listBackupArtifacts(db).map((artifact) => artifact.kind)).toEqual(["budget"]);
  });

  it("reuses a recent one instead of copying the same budget twice in a session", async () => {
    setUpPolicy();
    const first = await takeSafetyRecoveryPoint(db, { reason: "first change" });
    const second = await takeSafetyRecoveryPoint(db, { reason: "second change" });

    expect(second.status).toBe("reused");
    expect(second.artifactId).toBe(first.artifactId);
    expect(listBackupArtifacts(db)).toHaveLength(1);
  });

  it("takes a fresh one once the debounce window has passed", async () => {
    setUpPolicy();
    await takeSafetyRecoveryPoint(db, { reason: "first" });

    const later = new Date(Date.now() + 61 * 60_000);
    const outcome = await takeSafetyRecoveryPoint(db, { reason: "much later", now: later });

    expect(outcome.status).toBe("taken");
    expect(listBackupArtifacts(db)).toHaveLength(2);
  });

  it("does nothing when it has not been turned on", async () => {
    setUpPolicy({ safetyPoints: false });

    const outcome = await takeSafetyRecoveryPoint(db, { reason: "a change" });

    expect(outcome.status).toBe("disabled");
    expect(listBackupArtifacts(db)).toHaveLength(0);
  });

  it("says plainly when there is no rule it can use", async () => {
    writeSafetySettings(db, { enabled: true });
    const outcome = await takeSafetyRecoveryPoint(db, { reason: "a change" });

    expect(outcome.status).toBe("unavailable");
    expect(outcome.message).toMatch(/no backup rule/i);
  });

  it("reports a failure as a status rather than throwing at the user mid-action", async () => {
    // The caller is in the middle of saving. An exception here would turn "the
    // backup did not happen" into "your change did not happen".
    setUpPolicy();
    global.fetch = jest.fn(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const outcome = await takeSafetyRecoveryPoint(db, { reason: "a change" });

    expect(outcome.status).toBe("failed");
    expect(outcome.message).toMatch(/connection refused/);
  });

  it("is off until someone turns it on", () => {
    // An unexpected full budget export in front of a save is a surprise; not
    // having one is something you discover while reading the setting that
    // offers it.
    expect(readSafetySettings(db).enabled).toBe(false);
    expect(readSafetySettings(db).debounceMinutes).toBe(30);

    writeSafetySettings(db, { enabled: true });
    expect(readSafetySettings(db).enabled).toBe(true);
  });
});
