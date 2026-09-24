import { EnrolmentFailedError, enrollCredential, runFlowNow } from "./syncApi";
import type { AutomationRun } from "@/lib/app-db/types";

/**
 * Sync-flow "Run now" starts the flow's automation and follows the run (F-190,
 * F-191). The panel still reports the sync's own vocabulary, which the job
 * records in its result.
 */

function finishedRun(extra: Partial<AutomationRun>): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    type: "budget-file-sync",
    status: "succeeded",
    startedAt: "2026-09-24T10:00:00.000Z",
    finishedAt: "2026-09-24T10:00:05.000Z",
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

function answer(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

describe("runFlowNow", () => {
  it("reports the sync's own status and message from the finished run", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(answer(202, { runId: "run-1" }))
      .mockResolvedValueOnce(
        answer(200, {
          run: finishedRun({
            status: "partial",
            result: { version: 1, data: { status: "partial", message: "2 item(s) failed" } },
          }),
        })
      ) as unknown as typeof fetch;

    await expect(runFlowNow("flow-1")).resolves.toEqual({
      result: { status: "partial", message: "2 item(s) failed" },
    });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe("/api/sync-flows/flow-1/run-now");
  });

  it("falls back to the engine's status and roll-up when the run failed before the sync reported", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(answer(202, { runId: "run-1" }))
      .mockResolvedValueOnce(
        answer(200, {
          run: finishedRun({
            status: "failed",
            result: { version: 1, data: { log: [] } },
            rollup: { outcome: "failed", itemCount: 0, message: "The stored credential is no longer available." },
          }),
        })
      ) as unknown as typeof fetch;

    await expect(runFlowNow("flow-1")).resolves.toEqual({
      result: { status: "failed", message: "The stored credential is no longer available." },
    });
  });

  it("throws the route's reason when the run was refused", async () => {
    global.fetch = jest.fn(async () =>
      answer(409, { error: "This flow isn't set to sync unattended." })
    ) as unknown as typeof fetch;

    await expect(runFlowNow("flow-1")).rejects.toThrow("This flow isn't set to sync unattended.");
  });
});

describe("enrollCredential", () => {
  const input = {
    connectionFingerprint: "fp-1",
    mode: "browser-api",
    baseUrl: "https://actual.example.test",
    budgetSyncId: "budget-1",
    secret: { serverPassword: "pw" },
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const noWait = { sleep: async () => undefined };

  it("starts the enrolment and follows it until the server has stored it", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(reply(202, { enrolmentId: "e1" }))
      .mockResolvedValueOnce(reply(200, { status: "verifying" }))
      .mockResolvedValueOnce(reply(200, { status: "enrolled", credential: { connectionFingerprint: "fp-1" } }));

    await expect(enrollCredential(input, noWait)).resolves.toEqual({ credential: { connectionFingerprint: "fp-1" } });
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe("/api/sync-credentials/enrolments/e1");
  });

  it("throws the server's reason, with its code, when the check fails", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(reply(202, { enrolmentId: "e1" }))
      .mockResolvedValueOnce(reply(200, { status: "failed", code: "AUTH_FAILED", message: "Not accepted." }));

    const error = await enrollCredential(input, noWait).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EnrolmentFailedError);
    expect(error).toMatchObject({ code: "AUTH_FAILED", message: "Not accepted." });
  });

  it("rides out a few failed reads, but stops at once when the server no longer knows the enrolment", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(reply(202, { enrolmentId: "e1" }))
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(reply(500, { error: "busy" }))
      .mockResolvedValueOnce(reply(404, { error: "This enrolment is no longer being tracked." }));

    await expect(enrollCredential(input, noWait)).rejects.toThrow("no longer being tracked");
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it("throws the route's refusal without polling", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(reply(503, { error: "Bench is busy running automations." }));

    await expect(enrollCredential(input, noWait)).rejects.toThrow("busy");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
