/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createAutomation } from "@/lib/app-db/automationRepository";
import { createAutomationRun } from "@/lib/app-db/automationRunRepository";
import { __resetAutomationRegistryForTests, registerAutomationJobType } from "@/lib/automation/registry";
import { createTaskHost } from "./taskHost";
import type { WorkerToParentMessage } from "./protocol";

/**
 * What runs inside a worker thread, exercised in-thread: the same module the
 * worker entry wires to `parentPort`.
 */
describe("worker task host", () => {
  let root: string;
  const previousDbPath = process.env.ACTUAL_BENCH_DB_PATH;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "actual-bench-task-host-"));
    process.env.ACTUAL_BENCH_DB_PATH = join(root, "metadata.sqlite");
  });
  afterEach(() => {
    __resetAutomationRegistryForTests();
    resetAppDbForTests();
    rmSync(root, { recursive: true, force: true });
    if (previousDbPath === undefined) delete process.env.ACTUAL_BENCH_DB_PATH;
    else process.env.ACTUAL_BENCH_DB_PATH = previousDbPath;
  });

  function host() {
    const posted: WorkerToParentMessage[] = [];
    return { posted, host: createTaskHost((message) => posted.push(message)) };
  }

  function automationWithRun(): { automationId: string; runId: string } {
    const db = getAppDb();
    const automationId = createAutomation(db, {
      type: "host-test",
      name: "Host test",
      scheduleKind: "interval",
      intervalMinutes: 60,
      config: { version: 1, data: {} },
    }).id;
    const runId = createAutomationRun(db, { automationId, type: "host-test" }).id;
    return { automationId, runId };
  }

  it("runs an automation job and reports its phases and outcome", async () => {
    registerAutomationJobType({
      type: "host-test",
      label: "Host test",
      validateConfig: () => ({}),
      run: async (ctx) => {
        ctx.enterPhase("mutating");
        ctx.enterPhase("reading"); // ignored: phases only move forward
        return { wrote: 3 };
      },
      summarize: () => ({ outcome: "ok" as const, itemCount: 3, message: "Wrote 3" }),
      serializeResult: (result) => ({ version: 1, data: result }),
    });
    const { automationId, runId } = automationWithRun();
    const { host: taskHost, posted } = host();

    await taskHost.handle({
      type: "task",
      taskId: "t1",
      kind: "automation.run",
      input: { automationId, runId, attempt: 1, input: null },
    });

    expect(posted).toEqual([
      { type: "phase", taskId: "t1", phase: "mutating" },
      {
        type: "result",
        taskId: "t1",
        output: expect.objectContaining({
          kind: "completed",
          rollup: { outcome: "ok", itemCount: 3, message: "Wrote 3" },
          result: { version: 1, data: { wrote: 3 } },
          aborted: false,
        }),
      },
    ]);
  });

  it("aborts a running task's signal on cancel", async () => {
    let seenAbort = false;
    registerAutomationJobType({
      type: "host-test",
      label: "Host test",
      validateConfig: () => ({}),
      run: (ctx) =>
        new Promise((resolve) => {
          ctx.signal.addEventListener("abort", () => {
            seenAbort = true;
            resolve({});
          });
        }),
      summarize: () => ({ outcome: "ok" as const, itemCount: 0 }),
      serializeResult: () => ({ version: 1, data: {} }),
    });
    const { automationId, runId } = automationWithRun();
    const { host: taskHost, posted } = host();

    const running = taskHost.handle({
      type: "task",
      taskId: "t1",
      kind: "automation.run",
      input: { automationId, runId, attempt: 1, input: null },
    });
    await taskHost.handle({ type: "cancel", taskId: "t1" });
    await running;

    expect(seenAbort).toBe(true);
    expect(posted.at(-1)).toMatchObject({ type: "result", output: { kind: "completed", aborted: true } });
  });

  it("passes its self-test: every job type loads and a request goes through fetch", async () => {
    const { host: taskHost, posted } = host();

    await taskHost.handle({ type: "task", taskId: "preflight", kind: "preflight", input: null });

    expect(posted).toEqual([{ type: "result", taskId: "preflight", output: { ok: true } }]);
  });

  it("answers an unknown task kind with an error rather than silence", async () => {
    const { host: taskHost, posted } = host();

    await taskHost.handle({ type: "task", taskId: "t1", kind: "no.such.kind", input: {} });

    expect(posted).toEqual([{ type: "error", taskId: "t1", message: 'Unknown task kind "no.such.kind"' }]);
  });

  it("reports invalid task input as an error, redacted", async () => {
    const { host: taskHost, posted } = host();

    await taskHost.handle({ type: "task", taskId: "t1", kind: "automation.run", input: { password: "hunter2hunter2" } });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: "error", taskId: "t1" });
    expect(JSON.stringify(posted)).not.toContain("hunter2hunter2");
  });

  it("ignores messages that are not part of the protocol", async () => {
    const { host: taskHost, posted } = host();

    await taskHost.handle({ hello: "world" });
    await taskHost.handle(null);

    expect(posted).toEqual([]);
  });
});
