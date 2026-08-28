/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { listAutomations } from "@/lib/app-db/automationRepository";
import { listAutomationRuns } from "@/lib/app-db/automationRunRepository";
import {
  createBackupDestination,
  createBackupPolicy,
  listBackupArtifacts,
} from "@/lib/app-db/backupRepository";
import { upsertSyncCredential } from "@/lib/app-db/syncCredentialRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { ensureAutomationJobTypesRegistered } from "../bootstrap";
import { executeAutomation, reconcileJobTypes } from "../engine";
import { __resetAutomationRegistryForTests } from "../registry";
import { __resetBackupRegistrationForTests } from "./backup";
import { __resetBackupScrubRegistrationForTests } from "./backupScrub";
import { __resetBankSyncRegistrationForTests } from "./bankSync";
import { __resetBudgetFileSyncRegistrationForTests } from "./budgetFileSync";
import { BACKUP_JOB_TYPE } from "./backupType";
import { buildBudgetArchive } from "@/lib/backup/testFixtures";

/**
 * A backup all the way through the engine (RD-077 / PR-047d).
 *
 * The unit tests prove each part; this proves the wiring — that a rule created
 * on the Backups page becomes an automation, that the engine resolves its vault
 * credential rather than failing closed on it, that running it produces a
 * verified artifact on disk, and that the run history says something a person
 * can read.
 */

describe("a backup rule, end to end", () => {
  let root: string;
  let volume: string;
  let db: SqliteDatabase;
  const previousKey = process.env.SYNC_VAULT_KEY;
  const previousDbPath = process.env.ACTUAL_BENCH_DB_PATH;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.SYNC_VAULT_KEY = "test-vault-key";
    root = mkdtempSync(join(tmpdir(), "actual-bench-backup-e2e-"));
    volume = join(root, "volume");
    mkdirSync(volume, { recursive: true });
    // The job resolves the database the way the server does — from the
    // environment — so the test has to point that at the temp file rather than
    // handing the path in.
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    db = getAppDb();

    __resetAutomationRegistryForTests();
    __resetBackupRegistrationForTests();
    __resetBackupScrubRegistrationForTests();
    __resetBankSyncRegistrationForTests();
    __resetBudgetFileSyncRegistrationForTests();
    ensureAutomationJobTypesRegistered();

    global.fetch = jest.fn(async () => new Response(Buffer.from(buildBudgetArchive()), { status: 200 })) as
      unknown as typeof fetch;
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

  it("goes from a rule to a verified copy on disk, through the engine", async () => {
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
      config: { version: 1, data: { path: volume } },
    });
    createBackupPolicy(db, {
      name: "Nightly",
      contents: "budget",
      destinationIds: [destination.id],
      sourceRef: { version: 1, data: { connectionFingerprint: "conn-1" } },
      cronExpression: "0 2 * * *",
    });

    // The tick's reconcile is what turns a rule into an automation.
    await reconcileJobTypes(db);
    const [automation] = listAutomations(db, { type: BACKUP_JOB_TYPE });
    expect(automation).toBeDefined();
    expect(automation.credentialRef).toBe("conn-1");

    const outcome = await executeAutomation(db, automation.id, { trigger: "manual" });
    expect(outcome.status).toBe("succeeded");

    const [artifact] = listBackupArtifacts(db);
    expect(artifact.verificationStatus).toBe("passed");
    expect(readFileSync(join(volume, `budget/household/2026/${artifact.createdAt.slice(0, 10)}T${artifact.createdAt.slice(11, 19).replace(/:/g, "")}-${artifact.id.slice(0, 8)}.zip`)).byteLength).toBe(
      artifact.sizeBytes
    );

    const [run] = listAutomationRuns(db, { automationId: automation.id, limit: 1 });
    expect(run.rollup?.outcome).toBe("ok");
    expect(run.rollup?.message).toMatch(/Verified 1 copy/);
  });

  it("fails closed when the source connection is no longer enrolled", async () => {
    // The engine refuses before the job runs, so a withdrawn credential reads as
    // "not enrolled" rather than as a mysterious export error.
    const destination = createBackupDestination(db, {
      name: "Volume",
      kind: "local",
      config: { version: 1, data: { path: volume } },
    });
    createBackupPolicy(db, {
      name: "Nightly",
      contents: "budget",
      destinationIds: [destination.id],
      sourceRef: { version: 1, data: { connectionFingerprint: "conn-gone" } },
    });

    await reconcileJobTypes(db);
    const [automation] = listAutomations(db, { type: BACKUP_JOB_TYPE });
    const outcome = await executeAutomation(db, automation.id, { trigger: "manual" });

    // The engine refuses before the job starts, and pauses the automation with
    // the reason rather than recording a mystery failure.
    expect(outcome.status).toBe("skipped");
    expect(outcome.message).toMatch(/Re-enrol it to run unattended/);
    expect(listBackupArtifacts(db)).toHaveLength(0);
  });
});
