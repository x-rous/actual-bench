import {
  describeAutomationsSummary,
  executionModeCopy,
  relativeTime,
  runDuration,
  runStatusLabel,
  runStatusTone,
  triggerLabel,
} from "./presentation";
import type { AutomationRun } from "@/lib/app-db/types";

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    type: "budget-file-sync",
    status: "succeeded",
    startedAt: "2026-08-25T10:00:00.000Z",
    finishedAt: "2026-08-25T10:00:30.000Z",
    trigger: "schedule",
    attempt: 1,
    executionMode: "server",
    result: null,
    rollup: null,
    error: null,
    ...overrides,
  };
}

describe("execution-mode copy", () => {
  it("says a server automation runs with Bench closed", () => {
    const copy = executionModeCopy("server");
    expect(copy.detail).toMatch(/even with Actual Bench closed/i);
    // And does not over-promise: the engine is one instance, not a cluster.
    expect(copy.detail).toMatch(/One server instance/i);
  });

  it("says plainly that a browser automation stops when the tab closes", () => {
    const copy = executionModeCopy("browser");
    expect(copy.detail).toMatch(/only runs while Actual Bench is open/i);
    expect(copy.detail).toMatch(/not unattended automation/i);
    // The wording must never imply the opposite.
    expect(copy.detail).not.toMatch(/even with .* closed/i);
  });
});

describe("run status wording", () => {
  it("uses plain language rather than internal status names", () => {
    expect(runStatusLabel("no_changes")).toBe("Nothing to do");
    expect(runStatusLabel("partial")).toBe("Partly done");
    expect(runStatusLabel("succeeded")).toBe("Succeeded");
  });

  it("tones a partial run as a warning, not a success or a failure", () => {
    expect(runStatusTone("succeeded")).toBe("ok");
    expect(runStatusTone("partial")).toBe("warn");
    expect(runStatusTone("failed")).toBe("bad");
  });
});

describe("run detail formatting", () => {
  it("formats duration in units a person reads", () => {
    expect(runDuration(run({ finishedAt: "2026-08-25T10:00:00.400Z" }))).toBe("400 ms");
    expect(runDuration(run())).toBe("30.0 s");
    expect(runDuration(run({ finishedAt: "2026-08-25T10:05:00.000Z" }))).toBe("5 min");
    // An unfinished run has no duration to claim.
    expect(runDuration(run({ finishedAt: null }))).toBe("—");
  });

  it("names the trigger, including which retry attempt a run was", () => {
    expect(triggerLabel(run())).toBe("Scheduled");
    expect(triggerLabel(run({ trigger: "manual" }))).toBe("Run now");
    expect(triggerLabel(run({ trigger: "retry", attempt: 3 }))).toBe("Retry (attempt 3)");
  });

  it("renders relative time in both directions", () => {
    const now = Date.parse("2026-08-25T12:00:00Z");
    expect(relativeTime("2026-08-25T11:00:00Z", now)).toMatch(/hour ago/);
    expect(relativeTime("2026-08-25T12:30:00Z", now)).toMatch(/in 30 minutes/);
    expect(relativeTime(null, now)).toBe("—");
  });
});

describe("the page summary line", () => {
  const now = Date.parse("2026-08-26T12:00:00Z");
  const base = { status: "ok" as const, enabled: true, autoPausedAt: null, nextRunAt: null };

  it("answers whether the page can be closed again, not just how many rows it has", () => {
    expect(
      describeAutomationsSummary(
        [
          { ...base, nextRunAt: "2026-08-26T12:05:00.000Z" },
          { ...base, nextRunAt: "2026-08-26T12:30:00.000Z" },
        ],
        now
      )
    ).toBe("2 automations · all healthy · next run in 5 minutes");
  });

  it("leads with trouble, because silence about it reads as reassurance", () => {
    const summary = describeAutomationsSummary(
      [
        { ...base, status: "failing" },
        { ...base, status: "paused", enabled: false, autoPausedAt: "2026-08-26T09:00:00.000Z" },
        { ...base, nextRunAt: "2026-08-26T12:05:00.000Z" },
      ],
      now
    );

    expect(summary).toBe("3 automations · 1 failing, 1 paused · next run in 5 minutes");
    expect(summary).not.toMatch(/all healthy/);
  });

  it("does not promise a next run when nothing is scheduled", () => {
    expect(describeAutomationsSummary([{ ...base, enabled: false }], now)).toBe(
      "1 automation · all healthy"
    );
  });

  it("says nothing at all when there are no automations", () => {
    expect(describeAutomationsSummary([], now)).toBeUndefined();
  });
});
