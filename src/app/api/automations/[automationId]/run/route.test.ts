/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { claimAutomation, createAutomation } from "@/lib/app-db/automationRepository";
import { __resetEngineStateForTests, settleBackgroundRuns } from "@/lib/automation/engine";
import { __resetAutomationRegistryForTests, registerAutomationJobType } from "@/lib/automation/registry";
import { POST } from "./route";
import { GET } from "../../runs/[runId]/route";

/**
 * "Run now" answers as soon as the run exists and the page follows it by id
 * (F-191). A slow job must not hold the request open: a reverse proxy gives up
 * long before a large backup does, while the run carries on regardless.
 */
describe("POST /api/automations/[automationId]/run and GET /api/automations/runs/[runId]", () => {
  let root: string;
  const previousDbPath = process.env.ACTUAL_BENCH_DB_PATH;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-run-now-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
  });

  afterEach(async () => {
    await settleBackgroundRuns();
    __resetEngineStateForTests();
    __resetAutomationRegistryForTests();
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = previousDbPath;
  });

  function slowJob(): { finish: () => void } {
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    registerAutomationJobType({
      type: "slow-job",
      label: "Slow job",
      validateConfig: () => ({}),
      run: async () => {
        await gate;
        return { done: true };
      },
      summarize: () => ({ outcome: "ok" as const, itemCount: 1, message: "Did the slow thing." }),
      serializeResult: () => ({ version: 1, data: { done: true } }),
    });
    return { finish };
  }

  function automation(): string {
    return createAutomation(getAppDb(), {
      type: "slow-job",
      name: "Slow",
      scheduleKind: "interval",
      intervalMinutes: 60,
      config: { version: 1, data: {} },
    }).id;
  }

  const context = (automationId: string) => ({ params: Promise.resolve({ automationId }) });
  const runContext = (runId: string) => ({ params: Promise.resolve({ runId }) });

  it("answers 202 with the run id while the job is still going, and the run can be followed to its end", async () => {
    const job = slowJob();
    const id = automation();

    const response = await POST(new Request("http://bench.test"), context(id));
    expect(response.status).toBe(202);
    const { runId } = (await response.json()) as { runId: string };

    const whileRunning = await GET(new Request("http://bench.test"), runContext(runId));
    expect(((await whileRunning.json()) as { run: { status: string } }).run.status).toBe("running");

    job.finish();
    await settleBackgroundRuns();

    const finished = await GET(new Request("http://bench.test"), runContext(runId));
    const { run } = (await finished.json()) as {
      run: { status: string; trigger: string; rollup: { message: string } };
    };
    expect(run).toMatchObject({ status: "succeeded", trigger: "manual", rollup: { message: "Did the slow thing." } });
  });

  it("refuses a second run while one is going, rather than doubling up", async () => {
    slowJob();
    const id = automation();
    claimAutomation(getAppDb(), id, new Date().toISOString());

    const response = await POST(new Request("http://bench.test"), context(id));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "A run is already in progress" });
  });

  it("answers 404 for an automation that does not exist", async () => {
    const response = await POST(new Request("http://bench.test"), context("missing"));
    expect(response.status).toBe(404);
  });

  it("answers 404 for a run that does not exist", async () => {
    const response = await GET(new Request("http://bench.test"), runContext("missing"));
    expect(response.status).toBe(404);
  });
});
