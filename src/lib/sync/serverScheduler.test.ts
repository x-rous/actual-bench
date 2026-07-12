/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createSyncFlow } from "@/lib/app-db/syncFlowRepository";
import { upsertSyncCredential } from "@/lib/app-db/syncCredentialRepository";
import {
  getSchedulerState,
  isUnattendedFlowDue,
  runSchedulerTick,
  selectUnattendedFlowsToRun,
  __resetSchedulerStateForTests,
  type UnattendedFlow,
} from "./serverScheduler";
import type { JsonEnvelope, JsonObject, SqliteDatabase } from "@/lib/app-db/types";

const flow = (over: Partial<UnattendedFlow> = {}): UnattendedFlow => ({
  flowId: "f1",
  reviewPolicy: "auto_sync_unattended",
  enabled: true,
  intervalMinutes: 60,
  enrolled: true,
  lastRunAtMs: null,
  ...over,
});

const NONE = new Set<string>();

describe("selectUnattendedFlowsToRun (RD-058 / PR-024c)", () => {
  const now = 10_000_000_000;

  it("runs an enrolled, enabled, due unattended flow", () => {
    expect(isUnattendedFlowDue(flow(), NONE, NONE, now)).toBe(true);
  });

  it("skips non-unattended policy, disabled, not-enrolled, in-flight, or health-paused flows", () => {
    expect(isUnattendedFlowDue(flow({ reviewPolicy: "auto_sync_on_interval" }), NONE, NONE, now)).toBe(false);
    expect(isUnattendedFlowDue(flow({ enabled: false }), NONE, NONE, now)).toBe(false);
    expect(isUnattendedFlowDue(flow({ enrolled: false }), NONE, NONE, now)).toBe(false);
    expect(isUnattendedFlowDue(flow(), new Set(["f1"]), NONE, now)).toBe(false);
    expect(isUnattendedFlowDue(flow(), NONE, new Set(["f1"]), now)).toBe(false);
  });

  it("honours the interval floor and elapsed time", () => {
    // Interval below the floor is clamped to 15 min.
    expect(isUnattendedFlowDue(flow({ intervalMinutes: 1, lastRunAtMs: now - 5 * 60_000 }), NONE, NONE, now)).toBe(false);
    expect(isUnattendedFlowDue(flow({ intervalMinutes: 1, lastRunAtMs: now - 16 * 60_000 }), NONE, NONE, now)).toBe(true);
  });

  it("selects only due flow ids", () => {
    const flows = [flow({ flowId: "a" }), flow({ flowId: "b", enrolled: false }), flow({ flowId: "c" })];
    expect(selectUnattendedFlowsToRun({ flows, inFlight: NONE, pausedByHealth: NONE, nowMs: now })).toEqual(["a", "c"]);
  });
});

// ── Runner ──────────────────────────────────────────────────────────────────

const env = (data: JsonObject): JsonEnvelope => ({ version: 1, data });

function tempDb(): { root: string; db: SqliteDatabase } {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-scheduler-"));
  return { root, db: getAppDb(join(root, "metadata.sqlite")) };
}

function unattendedFlow(db: SqliteDatabase): string {
  const id = createSyncFlow(db, {
    name: "Nightly",
    legs: [
      {
        sourceRef: env({ connectionFingerprint: "src-fp", budgetId: "b-src", accountId: "acct-src" }),
        targetRef: env({ connectionFingerprint: "tgt-fp", budgetId: "b-tgt", accountId: "acct-tgt" }),
        filter: env({}),
        transform: env({}),
        options: env({ reviewPolicy: "auto_sync_unattended", intervalMinutes: 15 }),
      },
    ],
  }).id;
  for (const [fp, b] of [["src-fp", "b-src"], ["tgt-fp", "b-tgt"]] as const) {
    upsertSyncCredential(db, { connectionFingerprint: fp, mode: "http-api", baseUrl: "https://api.example.com", budgetSyncId: b, label: fp, secret: { apiKey: "k" } });
  }
  return id;
}

describe("runSchedulerTick (RD-058 / PR-024c)", () => {
  let root: string;
  let db: SqliteDatabase;
  const originalKey = process.env.SYNC_VAULT_KEY;

  beforeEach(() => {
    process.env.SYNC_VAULT_KEY = "test-key";
    __resetSchedulerStateForTests();
    ({ root, db } = tempDb());
  });
  afterEach(() => {
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (originalKey === undefined) delete process.env.SYNC_VAULT_KEY;
    else process.env.SYNC_VAULT_KEY = originalKey;
  });

  it("runs a due unattended flow once per tick", async () => {
    const flowId = unattendedFlow(db);
    const run = jest.fn(async () => ({ status: "no_safe_items" as const, flowId, runId: "r", reviewPolicy: "auto_sync_unattended" as const, preview: {} as never }));
    const summary = await runSchedulerTick(db, { run });
    expect(summary.ran).toEqual([{ flowId, status: "no_safe_items" }]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the vault is disabled", async () => {
    unattendedFlow(db);
    delete process.env.SYNC_VAULT_KEY;
    const run = jest.fn();
    const summary = await runSchedulerTick(db, { run });
    expect(summary.ran).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("pauses a flow after repeated failures (health), then stops running it", async () => {
    const flowId = unattendedFlow(db);
    const run = jest.fn(async () => ({ status: "not_enrolled" as const, flowId, message: "x" }));
    // No run rows are created, so the flow stays due each tick until it pauses.
    for (let i = 0; i < 5; i++) await runSchedulerTick(db, { run });
    expect(run).toHaveBeenCalledTimes(3); // paused after the 3rd consecutive failure
  });

  it("resumes a health-paused flow after it is edited (no restart needed)", async () => {
    const flowId = unattendedFlow(db);
    const failing = jest.fn(async () => ({ status: "not_enrolled" as const, flowId, message: "x" }));
    for (let i = 0; i < 4; i++) await runSchedulerTick(db, { run: failing });
    expect(failing).toHaveBeenCalledTimes(3); // paused

    // Editing the flow bumps updated_at past the pause time → next tick retries.
    db.prepare("UPDATE sync_flows SET updated_at = ? WHERE id = ?").run(
      new Date(Date.now() + 3_600_000).toISOString(),
      flowId
    );
    const ok = jest.fn(async () => ({ status: "no_safe_items" as const, flowId, runId: "r", reviewPolicy: "auto_sync_unattended" as const, preview: {} as never }));
    await runSchedulerTick(db, { run: ok });
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("publishes its state to the DB so a fresh module instance reads it (dev split)", async () => {
    const flowId = unattendedFlow(db);
    const run = jest.fn(async () => ({ status: "no_safe_items" as const, flowId, runId: "r", reviewPolicy: "auto_sync_unattended" as const, preview: {} as never }));
    await runSchedulerTick(db, { run });

    // Simulate a different module instance (route handler): in-memory is blank,
    // but the DB snapshot still reflects the tick.
    __resetSchedulerStateForTests();
    expect(getSchedulerState().lastTickAt).toBeNull(); // in-memory fallback: blank
    expect(getSchedulerState(db).lastTickAt).not.toBeNull(); // DB-backed: real
  });
});
