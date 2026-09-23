import { RunStillGoingError, startAndWaitForRun, waitForRun } from "./runPolling";
import type { AutomationRun } from "@/lib/app-db/types";

function run(status: AutomationRun["status"], extra: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    type: "backup",
    status,
    startedAt: "2026-09-24T10:00:00.000Z",
    finishedAt: status === "running" ? null : "2026-09-24T10:01:00.000Z",
    trigger: "manual",
    attempt: 1,
    executionMode: "server",
    result: null,
    rollup: null,
    error: null,
    input: null,
    ...extra,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

/** A clock that only moves when the poller sleeps, so tests take no real time. */
function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
  };
}

describe("waitForRun", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("follows a run until it stops running and returns the finished run", async () => {
    const answers = [run("running"), run("running"), run("succeeded", { rollup: { outcome: "ok", itemCount: 1, message: "Verified 1 copy." } })];
    const fetchMock = jest.fn(async () => jsonResponse(200, { run: answers.shift() }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const clock = fakeClock();

    const finished = await waitForRun("run-1", clock);

    expect(finished.status).toBe("succeeded");
    expect(finished.rollup?.message).toBe("Verified 1 copy.");
    expect(fetchMock).toHaveBeenCalledWith("/api/automations/runs/run-1", { cache: "no-store" });
    expect(clock.sleeps).toEqual([1_000, 1_000]);
  });

  it("slows down after the first few seconds", async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      return jsonResponse(200, { run: calls > 14 ? run("failed") : run("running") });
    }) as unknown as typeof fetch;
    const clock = fakeClock();

    await waitForRun("run-1", clock);

    expect(clock.sleeps.slice(0, 10).every((ms) => ms === 1_000)).toBe(true);
    expect(clock.sleeps.slice(10).every((ms) => ms === 2_000)).toBe(true);
  });

  it("hands the run over to run history rather than waiting forever", async () => {
    global.fetch = jest.fn(async () => jsonResponse(200, { run: run("running") })) as unknown as typeof fetch;

    await expect(waitForRun("run-1", { ...fakeClock(), maxWaitMs: 5_000 })).rejects.toBeInstanceOf(
      RunStillGoingError
    );
  });

  it("reports the server's reason when the run cannot be read", async () => {
    global.fetch = jest.fn(async () => jsonResponse(404, { error: "Run not found" })) as unknown as typeof fetch;

    await expect(waitForRun("run-1", fakeClock())).rejects.toThrow("Run not found");
  });
});

describe("startAndWaitForRun", () => {
  it("starts the run, then follows it by the id the route answered with", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(202, { runId: "run-9" }))
      .mockResolvedValueOnce(jsonResponse(200, { run: run("no_changes", { id: "run-9" }) }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const finished = await startAndWaitForRun("/api/automations/auto-1/run", { method: "POST" }, fakeClock());

    expect(finished).toMatchObject({ id: "run-9", status: "no_changes" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/automations/runs/run-9");
  });

  it("throws the route's own reason when the run was refused", async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(409, { error: "A run is already in progress" })
    ) as unknown as typeof fetch;

    await expect(
      startAndWaitForRun("/api/automations/auto-1/run", { method: "POST" }, fakeClock())
    ).rejects.toThrow("A run is already in progress");
  });
});
