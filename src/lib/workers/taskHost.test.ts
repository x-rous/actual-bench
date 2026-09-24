/**
 * @jest-environment node
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createAutomation } from "@/lib/app-db/automationRepository";
import { createAutomationRun } from "@/lib/app-db/automationRunRepository";
import { __resetAutomationRegistryForTests, registerAutomationJobType } from "@/lib/automation/registry";
import { __configureNodeHostForTests, __resetNodeHostForTests, getNodeRuntime } from "@/lib/actual/runtime/nodeHost";
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

  describe("a Direct budget the job opened", () => {
    const direct = {
      id: "direct-1",
      label: "Direct",
      mode: "browser-api" as const,
      baseUrl: "https://actual.example.test",
      budgetSyncId: "budget-1",
      serverPassword: "pw",
    };
    let upload: jest.Mock;

    beforeEach(() => {
      process.env.ACTUAL_BENCH_RUNTIME_DIR = join(root, "runtime");
      upload = jest.fn();
      const send = jest.fn(async (name: string) => (name === "upload-budget" ? upload() : null));
      __configureNodeHostForTests({
        allowMainThread: true,
        snapshots: { lastSnapshotAt: () => null, recordSnapshot: () => {} },
        loadApi: async () =>
          ({
            init: async () => ({ send }),
            downloadBudget: async () => undefined,
            sync: async () => undefined,
            shutdown: async () => undefined,
          }) as never,
      });
    });
    afterEach(() => {
      __resetNodeHostForTests();
      delete process.env.ACTUAL_BENCH_RUNTIME_DIR;
    });

    function openingJob(run: (ctx: { signal: AbortSignal }) => Promise<object>) {
      registerAutomationJobType({
        type: "host-test",
        label: "Host test",
        validateConfig: () => ({}),
        run: async (ctx) => {
          await getNodeRuntime(direct);
          return run(ctx);
        },
        summarize: () => ({ outcome: "ok" as const, itemCount: 1 }),
        serializeResult: () => ({ version: 1, data: {} }),
      });
    }

    it("refreshes its snapshot after a clean run, and closes it", async () => {
      upload.mockResolvedValue({});
      openingJob(async () => ({}));
      const { automationId, runId } = automationWithRun();
      const { host: taskHost, posted } = host();

      await taskHost.handle({ type: "task", taskId: "t1", kind: "automation.run", input: { automationId, runId, attempt: 1, input: null } });

      expect(upload).toHaveBeenCalledTimes(1);
      expect(posted.at(-1)).toMatchObject({ type: "result", output: { kind: "completed", aborted: false } });
      expect(readdirSync(join(root, "runtime"))).toEqual([]);
    });

    it("skips the refresh for a run that was stopped", async () => {
      openingJob((ctx) => new Promise((resolve) => ctx.signal.addEventListener("abort", () => resolve({}))));
      const { automationId, runId } = automationWithRun();
      const { host: taskHost } = host();

      const running = taskHost.handle({ type: "task", taskId: "t1", kind: "automation.run", input: { automationId, runId, attempt: 1, input: null } });
      await new Promise((resolve) => setTimeout(resolve, 20));
      await taskHost.handle({ type: "cancel", taskId: "t1" });
      await running;

      expect(upload).not.toHaveBeenCalled();
    });

    it("answers at once when stopped during the refresh, and cleans up only once the upload is done", async () => {
      let finishUpload: (value: unknown) => void = () => {};
      upload.mockReturnValue(new Promise((resolve) => (finishUpload = resolve)));
      openingJob(async () => ({}));
      const { automationId, runId } = automationWithRun();
      const { host: taskHost, posted } = host();

      const running = taskHost.handle({ type: "task", taskId: "t1", kind: "automation.run", input: { automationId, runId, attempt: 1, input: null } });
      while (upload.mock.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
      await taskHost.handle({ type: "cancel", taskId: "t1" });
      while (!posted.some((message) => message.type === "result")) await new Promise((resolve) => setTimeout(resolve, 5));

      // The job had finished: it is reported as it finished, not as stopped,
      // and without waiting for the upload.
      expect(posted.at(-1)).toMatchObject({ type: "result", output: { kind: "completed", aborted: false } });
      // The upload is still reading the budget copy, so it is still there.
      expect(readdirSync(join(root, "runtime"))).toHaveLength(1);

      finishUpload({});
      await running;
      expect(readdirSync(join(root, "runtime"))).toEqual([]);
    });
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
