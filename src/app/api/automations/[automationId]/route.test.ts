jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createAutomation, pauseAutomationForHealth } from "@/lib/app-db/automationRepository";
import { PATCH } from "./route";
import type { AutomationDefinition } from "@/lib/app-db/types";

function request(body: unknown): Request {
  return { json: async () => body } as Request;
}

function context(automationId: string) {
  return { params: Promise.resolve({ automationId }) };
}

describe("PATCH /api/automations/[automationId]", () => {
  let root: string;
  let id: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-automation-patch-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
    id = createAutomation(getAppDb(), {
      type: "budget-file-sync",
      name: "Nightly sync",
      scheduleKind: "interval",
      intervalMinutes: 30,
      targetRef: { version: 1, data: {} },
      config: { version: 1, data: { flowId: "flow-1" } },
    }).id;
  });

  afterEach(() => {
    resetAppDbForTests();
    delete process.env.ACTUAL_BENCH_DB_PATH;
    rmSync(root, { recursive: true, force: true });
  });

  it("answers 400, not 500, for a null body", async () => {
    const response = await PATCH(request(null), context(id));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/must be an object/);
  });

  it("resumes a paused automation, clearing the pause and the failure streak", async () => {
    pauseAutomationForHealth(getAppDb(), id, "2026-08-26T01:00:00.000Z", "vault key missing");

    const response = await PATCH(request({ resume: true }), context(id));
    const { automation } = (await response.json()) as { automation: AutomationDefinition };

    expect(automation.enabled).toBe(true);
    expect(automation.autoPausedAt).toBeNull();
    expect(automation.consecutiveFailures).toBe(0);
  });

  it("edits a schedule without touching the pause", async () => {
    pauseAutomationForHealth(getAppDb(), id, "2026-08-26T01:00:00.000Z", "vault key missing");

    const response = await PATCH(request({ intervalMinutes: 45 }), context(id));
    const { automation } = (await response.json()) as { automation: AutomationDefinition };

    expect(automation.intervalMinutes).toBe(45);
    expect(automation.autoPausedAt).toBe("2026-08-26T01:00:00.000Z");
  });

  it("answers 404 for an automation that does not exist", async () => {
    const response = await PATCH(request({ enabled: false }), context("nope"));
    expect(response.status).toBe(404);
  });
});
