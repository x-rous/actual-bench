import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { listAutomations } from "@/lib/app-db/automationRepository";
import { listAutomationRuns } from "@/lib/app-db/automationRunRepository";
import { listSyncFlowRuns } from "@/lib/app-db/syncRunRepository";
import { migrateSyncFlowsToAutomations } from "./jobs/budgetFileSyncMigration";
import {
  __resetBudgetFileSyncRegistrationForTests,
  registerBudgetFileSyncJobType,
} from "./jobs/budgetFileSync";
import { __resetAutomationRegistryForTests } from "./registry";
import { __resetEngineStateForTests, selectDueAutomations } from "./engine";

/**
 * An upgrade rehearsal, not a unit test.
 *
 * Builds a database the way a real installation looks before this change — a
 * v17 schema carrying an enrolled unattended flow that synced minutes ago — then
 * runs the boot path exactly as `instrumentation.ts` does, and asserts what the
 * operator should see on the other side. The migration is the only part of this
 * work that touches something people are already running unattended.
 */

function v17DatabaseWithUnattendedFlow(): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-upgrade-rehearsal-"));
  const path = join(root, "metadata.sqlite");
  const db = new Database(path);

  db.exec(`
    CREATE TABLE app_meta (key text PRIMARY KEY, value text NOT NULL, updated_at text NOT NULL);
    CREATE TABLE sync_flows (
      id text PRIMARY KEY, name text NOT NULL, enabled integer NOT NULL DEFAULT 1,
      flow_type text NOT NULL DEFAULT 'transaction_sync', description text,
      created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE sync_flow_legs (
      id text PRIMARY KEY, flow_id text NOT NULL, position integer NOT NULL,
      source_ref_json text NOT NULL, target_ref_json text NOT NULL, filter_json text NOT NULL,
      transform_json text NOT NULL, options_json text NOT NULL,
      created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE sync_flow_runs (
      id text PRIMARY KEY, flow_id text, status text NOT NULL, started_at text NOT NULL,
      finished_at text, summary_json text NOT NULL, error_json text,
      created_by_trigger text NOT NULL DEFAULT 'manual_preview',
      source_snapshot_summary_json text, target_snapshot_summary_json text, counts_json text
    );
  `);

  const now = new Date();
  const twoMinutesAgo = new Date(now.getTime() - 2 * 60_000).toISOString();
  db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run(
    "schema_version",
    "17",
    twoMinutesAgo
  );
  db.prepare(
    `INSERT INTO sync_flows (id, name, enabled, created_at, updated_at)
     VALUES ('flow-live', 'Household → Joint', 1, ?, ?)`
  ).run(twoMinutesAgo, twoMinutesAgo);
  db.prepare(
    `INSERT INTO sync_flow_legs
       (id, flow_id, position, source_ref_json, target_ref_json, filter_json, transform_json, options_json, created_at, updated_at)
     VALUES ('leg-1', 'flow-live', 0, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    JSON.stringify({ version: 1, data: { connectionFingerprint: "server-a", budgetSyncId: "budget-a" } }),
    JSON.stringify({ version: 1, data: { connectionFingerprint: "server-b", budgetSyncId: "budget-b" } }),
    JSON.stringify({ version: 1, data: {} }),
    JSON.stringify({ version: 1, data: {} }),
    JSON.stringify({ version: 1, data: { reviewPolicy: "auto_sync_unattended", intervalMinutes: 60 } }),
    twoMinutesAgo,
    twoMinutesAgo
  );
  // It synced two minutes before the upgrade.
  db.prepare(
    `INSERT INTO sync_flow_runs (id, flow_id, status, started_at, finished_at, summary_json, created_by_trigger)
     VALUES ('sync-run-1', 'flow-live', 'applied', ?, ?, ?, 'scheduled_unattended')`
  ).run(twoMinutesAgo, twoMinutesAgo, JSON.stringify({ version: 1, data: {} }));

  db.close();
  return { root, path };
}

describe("upgrading an installation that is already syncing unattended", () => {
  afterEach(() => {
    __resetEngineStateForTests();
    __resetAutomationRegistryForTests();
    __resetBudgetFileSyncRegistrationForTests();
    resetAppDbForTests();
  });

  it("keeps the flow running on its own schedule, without a burst on boot", () => {
    const { root, path } = v17DatabaseWithUnattendedFlow();
    try {
      // The boot path, in the order instrumentation.ts runs it.
      const db = getAppDb(path);
      registerBudgetFileSyncJobType();
      const summary = migrateSyncFlowsToAutomations(db);

      expect(summary.created).toHaveLength(1);

      const [automation] = listAutomations(db);
      expect(automation.name).toBe("Household → Joint");
      expect(automation.enabled).toBe(true);
      expect(automation.intervalMinutes).toBe(60);
      expect(automation.credentialRef).toBe("server-a");

      // The first tick after boot must NOT run it: it synced two minutes ago,
      // and its hour is not up.
      expect(selectDueAutomations(db, Date.now())).toHaveLength(0);
      // An hour later it is due, as it would have been before the upgrade.
      expect(selectDueAutomations(db, Date.now() + 61 * 60_000)).toHaveLength(1);

      // Pre-upgrade sync history is untouched and still readable.
      expect(listSyncFlowRuns(db, { flowId: "flow-live" })).toHaveLength(1);
      // And no automation run has been invented for something that already ran.
      expect(listAutomationRuns(db)).toHaveLength(0);
    } finally {
      // Close the connection before deleting the file: an open SQLite handle
      // blocks removal on Windows, whatever `force` says.
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is safe to boot twice", () => {
    const { root, path } = v17DatabaseWithUnattendedFlow();
    try {
      const db = getAppDb(path);
      registerBudgetFileSyncJobType();
      migrateSyncFlowsToAutomations(db);

      // Restart.
      resetAppDbForTests();
      const reopened = getAppDb(path);
      migrateSyncFlowsToAutomations(reopened);

      expect(listAutomations(reopened)).toHaveLength(1);
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
