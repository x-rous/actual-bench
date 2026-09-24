/**
 * @jest-environment node
 */
import {
  __configureWorkerSupervisorForTests,
  ensureWorkerPreflight,
  runWorkerTask,
  workerAvailability,
  workerSupervisorStatus,
} from "./supervisor";
import { scriptedSpawn } from "./testing/fakeWorker";

/**
 * The supervisor's promises (RD-095): capacity is bounded, every task settles
 * whatever its worker does, and a task that will not stop is ended - with the
 * phase it had reached, which decides what the engine records.
 */
describe("worker supervisor", () => {
  afterEach(() => {
    __configureWorkerSupervisorForTests();
  });

  const signal = () => new AbortController().signal;
  /** Let a terminate's settle-up (the slot release) run. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it("keeps a slot taken until its thread has actually gone, not merely until the task settled", async () => {
    // Ending a thread is asynchronous. Releasing on settle let a burst of
    // start-and-cancel run more live threads than the limit.
    let finishTerminate: () => void = () => {};
    const { spawn, workers } = scriptedSpawn(() => {}, { ready: false });
    __configureWorkerSupervisorForTests({ spawn, maxSlots: 1 });
    const controller = new AbortController();

    const pending = runWorkerTask("any.kind", {}, { signal: controller.signal });
    workers[0].terminate = () =>
      new Promise<number>((resolve) => {
        finishTerminate = () => resolve(1);
      });
    controller.abort();

    // The caller hears straight away...
    await expect(pending).resolves.toMatchObject({ status: "stopped", code: "CANCELLED" });
    // ...but the thread is still going, so its slot is still taken.
    await flush();
    expect(workerSupervisorStatus().slots.busy).toBe(1);
    expect(workerAvailability()).toMatchObject({ ok: false, code: "NO_CAPACITY" });

    finishTerminate();
    await flush();
    expect(workerSupervisorStatus().slots.busy).toBe(0);
  });

  it("runs a task and frees its slot", async () => {
    const { spawn, workers } = scriptedSpawn((worker, task) => {
      worker.send({ type: "result", taskId: task.taskId, output: { answer: 42 } });
    });
    __configureWorkerSupervisorForTests({ spawn, maxSlots: 1 });

    const outcome = await runWorkerTask("any.kind", { question: "?" }, { signal: signal() });

    expect(outcome).toEqual({ status: "result", output: { answer: 42 } });
    expect(workers[0].terminated).toBe(true);
    await flush();
    expect(workerSupervisorStatus().slots).toEqual({ max: 1, busy: 0 });
  });

  it("takes a slot synchronously and refuses beyond the limit", async () => {
    const { spawn } = scriptedSpawn(() => {
      // Never answers.
    });
    __configureWorkerSupervisorForTests({ spawn, maxSlots: 1, graceMs: 5 });
    const controller = new AbortController();

    const first = runWorkerTask("any.kind", {}, { signal: controller.signal });
    expect(workerAvailability()).toEqual(expect.objectContaining({ ok: false, code: "NO_CAPACITY" }));
    await expect(runWorkerTask("any.kind", {}, { signal: signal() })).resolves.toMatchObject({
      status: "stopped",
      code: "NO_CAPACITY",
    });

    controller.abort();
    await first;
    await flush();
    expect(workerAvailability()).toEqual({ ok: true });
  });

  it("ends a task that ignores a cancel, reporting the phase it reached", async () => {
    const { spawn, workers } = scriptedSpawn((worker, task) => {
      worker.send({ type: "phase", taskId: task.taskId, phase: "mutating" });
      // ...and never finishes, never honours cancel.
    });
    __configureWorkerSupervisorForTests({ spawn, graceMs: 10 });
    const controller = new AbortController();

    const pending = runWorkerTask("any.kind", {}, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort({ code: "TIMEOUT" });

    await expect(pending).resolves.toMatchObject({ status: "stopped", code: "TIMEOUT", phase: "mutating" });
    expect(workers[0].posted).toContainEqual(expect.objectContaining({ type: "cancel" }));
    expect(workers[0].terminated).toBe(true);
  });

  it("never starts a task cancelled while its worker was still starting", async () => {
    // The worker says ready only after the cancel: sending the task then
    // would start a job the user had already stopped.
    const { spawn, workers } = scriptedSpawn(() => {}, { ready: false });
    __configureWorkerSupervisorForTests({ spawn, graceMs: 5_000 });
    const controller = new AbortController();

    const pending = runWorkerTask("any.kind", {}, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ status: "stopped", code: "CANCELLED", phase: "reading" });

    workers[0].emit("message", { type: "ready", protocol: 1, nodeVersion: "v22", heapLimitMb: 512 });
    expect(workers[0].posted.some((message) => (message as { type?: string }).type === "task")).toBe(false);
    await flush();
    expect(workerSupervisorStatus().slots.busy).toBe(0);
  });

  it("lets a task that honours a cancel finish on its own", async () => {
    const { spawn } = scriptedSpawn((worker, task) => {
      worker.onParentMessage = (message) => {
        if ((message as { type?: string }).type === "cancel") {
          worker.send({ type: "result", taskId: task.taskId, output: { stoppedCleanly: true } });
        }
      };
    });
    __configureWorkerSupervisorForTests({ spawn, graceMs: 5_000 });
    const controller = new AbortController();

    const pending = runWorkerTask("any.kind", {}, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();

    await expect(pending).resolves.toEqual({ status: "result", output: { stoppedCleanly: true } });
  });

  it("reports a worker that runs out of memory, and remembers the crash", async () => {
    const { spawn } = scriptedSpawn((worker) => {
      setImmediate(() =>
        worker.emit("error", Object.assign(new Error("heap limit"), { code: "ERR_WORKER_OUT_OF_MEMORY" }))
      );
    });
    __configureWorkerSupervisorForTests({ spawn });

    await expect(runWorkerTask("any.kind", {}, { signal: signal() })).resolves.toMatchObject({
      status: "stopped",
      code: "OUT_OF_MEMORY",
      phase: "reading",
    });
    expect(workerSupervisorStatus().lastCrash).toMatchObject({ code: "OUT_OF_MEMORY" });
  });

  it("settles a task whose worker exits without answering", async () => {
    const { spawn } = scriptedSpawn((worker) => {
      setImmediate(() => worker.emit("exit", 1));
    });
    __configureWorkerSupervisorForTests({ spawn });

    await expect(runWorkerTask("any.kind", {}, { signal: signal() })).resolves.toMatchObject({
      status: "stopped",
      code: "WORKER_DIED",
    });
  });

  it("ignores messages that do not follow the protocol", async () => {
    const { spawn } = scriptedSpawn((worker, task) => {
      worker.send({ type: "result" }); // no taskId
      worker.send({ nonsense: true });
      worker.send({ type: "result", taskId: task.taskId, output: "ok" });
    });
    __configureWorkerSupervisorForTests({ spawn });

    await expect(runWorkerTask("any.kind", {}, { signal: signal() })).resolves.toEqual({ status: "result", output: "ok" });
  });

  describe("preflight", () => {
    it("records a worker that starts and passes its self-test", async () => {
      const { spawn, workers } = scriptedSpawn((worker, task) => {
        worker.send({ type: "result", taskId: task.taskId, output: { ok: true } });
      });
      __configureWorkerSupervisorForTests({ spawn });

      await expect(ensureWorkerPreflight()).resolves.toMatchObject({ status: "ready", heapLimitMb: 512 });
      expect(workerAvailability()).toEqual({ ok: true });
      expect(workers[0].posted).toContainEqual(expect.objectContaining({ type: "task", kind: "preflight" }));
    });

    it("fails a worker that starts but cannot run its self-test", async () => {
      // How the first real run failed: the worker came up, and the first
      // request a job made threw inside Next's fetch. Ready is not enough.
      const { spawn } = scriptedSpawn((worker, task) => {
        worker.send({
          type: "error",
          taskId: task.taskId,
          message: "Invariant: AsyncLocalStorage accessed in runtime where it is not available",
        });
      });
      __configureWorkerSupervisorForTests({ spawn });

      await expect(ensureWorkerPreflight()).resolves.toMatchObject({
        status: "failed",
        error: expect.stringMatching(/could not run its self-test: Invariant: AsyncLocalStorage/),
      });
      expect(workerAvailability()).toMatchObject({ ok: false, code: "WORKER_UNAVAILABLE" });
    });

    it("stops runs, with the reason, when no worker can start - and tries again later", async () => {
      let attempts = 0;
      __configureWorkerSupervisorForTests({
        spawn: () => {
          attempts += 1;
          throw new Error("worker_threads is not supported here");
        },
        preflightRetryMs: 60_000,
      });

      await expect(ensureWorkerPreflight()).resolves.toMatchObject({ status: "failed" });
      expect(workerAvailability()).toEqual(
        expect.objectContaining({ ok: false, code: "WORKER_UNAVAILABLE", message: expect.stringMatching(/not supported/) })
      );

      await ensureWorkerPreflight(Date.now() + 1_000);
      expect(attempts).toBe(1);
      await ensureWorkerPreflight(Date.now() + 61_000);
      expect(attempts).toBe(2);
    });

    it("fails a worker that never answers", async () => {
      __configureWorkerSupervisorForTests({
        spawn: scriptedSpawn(() => {}, { ready: false }).spawn,
        preflightTimeoutMs: 20,
      });

      await expect(ensureWorkerPreflight()).resolves.toMatchObject({
        status: "failed",
        error: expect.stringMatching(/no answer/),
      });
    });
  });
});
