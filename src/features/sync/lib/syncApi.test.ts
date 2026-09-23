import { runFlowNow } from "./syncApi";
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
