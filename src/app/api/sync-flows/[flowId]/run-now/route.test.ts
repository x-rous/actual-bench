/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { claimAutomation, getAutomation, listAutomations } from "@/lib/app-db/automationRepository";
import { getAutomationRun } from "@/lib/app-db/automationRunRepository";
import { upsertSyncCredential } from "@/lib/app-db/syncCredentialRepository";
import { createSyncFlow, updateSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { __resetEngineStateForTests, settleBackgroundRuns } from "@/lib/automation/engine";
import { migrateSyncFlowsToAutomations } from "@/lib/automation/jobs/budgetFileSyncMigration";
import { BUDGET_FILE_SYNC_JOB_TYPE } from "@/lib/automation/jobs/budgetFileSyncType";
import { __resetAutomationRegistryForTests, registerAutomationJobType } from "@/lib/automation/registry";
import { POST } from "./route";

/**
 * Sync-flow "Run now" starts the flow's automation, exactly as its schedule
 * does (F-190). It used to call the sync directly: no single-run claim, no
 * automation run in history, no health update, and nothing stopping it from
 * overlapping a scheduled run of the same flow.
 *
 * The real Budget File Sync job needs two live servers, so a stand-in is
 * registered under its type; the route, the engine, reconciliation and the
 * credential check are all real.
 */
describe("POST /api/sync-flows/[flowId]/run-now", () => {
  let root: string;
  const previousDbPath = process.env.ACTUAL_BENCH_DB_PATH;
  const previousVaultKey = process.env.SYNC_VAULT_KEY;
  let seenFlowIds: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-flow-run-now-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    process.env.SYNC_VAULT_KEY = "test-operator-key";
    seenFlowIds = [];
    registerAutomationJobType({
      type: BUDGET_FILE_SYNC_JOB_TYPE,
      label: "Budget File Sync",
      validateConfig: (raw) => ({ flowId: String(raw.data.flowId) }),
      run: async (ctx) => {
        seenFlowIds.push(ctx.config.flowId);
        return { status: "applied", message: null };
      },
      summarize: () => ({ outcome: "ok" as const, itemCount: 1 }),
      serializeResult: (result) => ({ version: 1, data: result }),
      reconcile: (db) => {
        migrateSyncFlowsToAutomations(db);
      },
    });
    upsertSyncCredential(getAppDb(), {
      connectionFingerprint: "server-a",
      mode: "http-api",
      baseUrl: "https://api-a.example.com",
      budgetSyncId: "budget-a",
      label: "A",
      secret: { apiKey: "key-a" },
    });
  });

  afterEach(async () => {
    await settleBackgroundRuns();
    __resetEngineStateForTests();
    __resetAutomationRegistryForTests();
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = previousDbPath;
    if (previousVaultKey === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = previousVaultKey;
  });

  function flow(reviewPolicy: string): string {
    return createSyncFlow(getAppDb(), {
      name: "Household to Joint",
      legs: [
        {
          sourceRef: { version: 1, data: { connectionFingerprint: "server-a", budgetSyncId: "budget-a" } },
          targetRef: { version: 1, data: { connectionFingerprint: "server-b", budgetSyncId: "budget-b" } },
          filter: { version: 1, data: {} },
          transform: { version: 1, data: {} },
          options: { version: 1, data: { reviewPolicy, intervalMinutes: 30 } },
        },
      ],
    }).id;
  }

  const context = (flowId: string) => ({ params: Promise.resolve({ flowId }) });

  it("starts the flow's automation, which records the run and releases its claim", async () => {
    // Saved moments ago: its automation does not exist until the route
    // reconciles, which is the case a freshly armed flow is in.
    const flowId = flow("auto_sync_unattended");

    const response = await POST(new Request("http://bench.test"), context(flowId));
    expect(response.status).toBe(202);
    const { runId, automationId } = (await response.json()) as { runId: string; automationId: string };

    await settleBackgroundRuns();

    expect(seenFlowIds).toEqual([flowId]);
    expect(getAutomationRun(getAppDb(), runId)).toMatchObject({
      automationId,
      trigger: "manual",
      status: "succeeded",
      result: { data: { status: "applied" } },
    });
    expect(getAutomation(getAppDb(), automationId)?.runningSince).toBeNull();
  });

  it("refuses while the flow's scheduled run is going, instead of overlapping it", async () => {
    const flowId = flow("auto_sync_unattended");
    migrateSyncFlowsToAutomations(getAppDb());
    const [automation] = listAutomations(getAppDb(), { type: BUDGET_FILE_SYNC_JOB_TYPE });
    claimAutomation(getAppDb(), automation.id, new Date().toISOString());

    const response = await POST(new Request("http://bench.test"), context(flowId));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "A run is already in progress" });
    expect(seenFlowIds).toEqual([]);
  });

  it("does not run a flow whose unattended sync has been paused", async () => {
    // Paused after repeated failures: still set to unattended, but
    // reconciliation has turned its automation off.
    const flowId = flow("auto_sync_unattended");
    migrateSyncFlowsToAutomations(getAppDb());
    updateSyncFlow(getAppDb(), flowId, {
      legs: [
        {
          sourceRef: { version: 1, data: { connectionFingerprint: "server-a", budgetSyncId: "budget-a" } },
          targetRef: { version: 1, data: { connectionFingerprint: "server-b", budgetSyncId: "budget-b" } },
          filter: { version: 1, data: {} },
          transform: { version: 1, data: {} },
          options: {
            version: 1,
            data: {
              reviewPolicy: "auto_sync_unattended",
              intervalMinutes: 30,
              autoPausedAt: "2026-09-24T00:00:00.000Z",
            },
          },
        },
      ],
    });

    const response = await POST(new Request("http://bench.test"), context(flowId));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This flow's unattended sync is paused or turned off, so it cannot run now.",
    });
    expect(seenFlowIds).toEqual([]);
  });

  it("says so when the flow is not set to sync unattended", async () => {
    const flowId = flow("manual_preview_required");

    const response = await POST(new Request("http://bench.test"), context(flowId));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "This flow isn't set to sync unattended." });
  });

  it("does not run a disabled flow", async () => {
    const flowId = flow("auto_sync_unattended");
    updateSyncFlow(getAppDb(), flowId, { enabled: false });

    const response = await POST(new Request("http://bench.test"), context(flowId));

    expect(response.status).toBe(409);
    expect(seenFlowIds).toEqual([]);
  });

  it("refuses when the vault is off, since unattended sync cannot reach its credentials", async () => {
    const flowId = flow("auto_sync_unattended");
    delete process.env.SYNC_VAULT_KEY;

    const response = await POST(new Request("http://bench.test"), context(flowId));

    expect(response.status).toBe(400);
  });

  it("answers 404 for a flow that does not exist", async () => {
    const response = await POST(new Request("http://bench.test"), context("missing"));
    expect(response.status).toBe(404);
  });
});
