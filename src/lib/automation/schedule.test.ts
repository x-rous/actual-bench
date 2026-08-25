import { describeCronExpression, isValidCronExpression, parseCronExpression, CronParseError } from "./cron";
import {
  MIN_INTERVAL_MINUTES,
  backoffDelayMinutes,
  describeSchedule,
  effectiveNextRunAt,
  isDue,
  nextCronRun,
  nextIntervalRun,
  nextRunAt,
  zonedParts,
} from "./schedule";

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

describe("cron parsing", () => {
  it("parses the five fields with wildcards, lists, ranges and steps", () => {
    const cron = parseCronExpression("0,30 9-17/4 * * 1-5");

    expect(cron.minute.values).toEqual([0, 30]);
    expect(cron.hour.values).toEqual([9, 13, 17]);
    expect(cron.dayOfMonth.wildcard).toBe(true);
    expect(cron.dayOfWeek.values).toEqual([1, 2, 3, 4, 5]);
  });

  it("normalizes 7 to Sunday", () => {
    expect(parseCronExpression("0 6 * * 7").dayOfWeek.values).toEqual([0]);
  });

  it("rejects expressions it cannot honor exactly", () => {
    expect(() => parseCronExpression("0 6 * *")).toThrow(/exactly 5 fields/);
    expect(() => parseCronExpression("0 6 * * MON")).toThrow(CronParseError);
    expect(() => parseCronExpression("60 6 * * *")).toThrow(/outside 0-59/);
    expect(() => parseCronExpression("0 17-9 * * *")).toThrow(/ends before it starts/);
    // Unsupported day modifiers are refused rather than silently ignored.
    expect(isValidCronExpression("0 6 L * *")).toBe(false);
    expect(isValidCronExpression("@daily")).toBe(false);
  });
});

describe("next cron run", () => {
  it("finds the next daily occurrence in the definition's zone, not the server's", () => {
    // 05:00 UTC = 06:00 Berlin (winter). A daily 06:00 Berlin schedule fires at
    // 05:00 UTC in January and 04:00 UTC in July — the point of storing a zone.
    const winter = nextCronRun("0 6 * * *", "Europe/Berlin", Date.parse("2026-01-15T00:00:00Z"));
    expect(iso(winter)).toBe("2026-01-15T05:00:00.000Z");

    const summer = nextCronRun("0 6 * * *", "Europe/Berlin", Date.parse("2026-07-15T00:00:00Z"));
    expect(iso(summer)).toBe("2026-07-15T04:00:00.000Z");
  });

  it("rolls to the next day when today's time has passed", () => {
    const next = nextCronRun("0 6 * * *", "UTC", Date.parse("2026-01-15T06:00:00Z"));
    expect(iso(next)).toBe("2026-01-16T06:00:00.000Z");
  });

  it("honors day-of-week restrictions", () => {
    // 2026-08-25 is a Tuesday; the next Saturday is the 29th.
    const next = nextCronRun("30 9 * * 6", "UTC", Date.parse("2026-08-25T12:00:00Z"));
    expect(iso(next)).toBe("2026-08-29T09:30:00.000Z");
  });

  it("treats day-of-month and day-of-week as OR when both are restricted", () => {
    // The 1st of the month OR any Monday.
    const next = nextCronRun("0 0 1 * 1", "UTC", Date.parse("2026-08-25T12:00:00Z"));
    // 2026-08-31 is a Monday, before the 1st of September.
    expect(iso(next)).toBe("2026-08-31T00:00:00.000Z");
  });

  it("runs once, at the first occurrence, when a local hour repeats (fall back)", () => {
    // Europe/Berlin 2026-10-25: 03:00 CEST → 02:00 CET, so 02:30 happens twice
    // (00:30 UTC and 01:30 UTC). A backup scheduled for 02:30 must not run twice.
    const first = nextCronRun("30 2 * * *", "Europe/Berlin", Date.parse("2026-10-24T12:00:00Z"));
    expect(iso(first)).toBe("2026-10-25T00:30:00.000Z");

    // Searching again from just after the first occurrence must skip the repeat
    // and land on the next day.
    const following = nextCronRun("30 2 * * *", "Europe/Berlin", first! + 60_000);
    expect(iso(following)).toBe("2026-10-26T01:30:00.000Z");
  });

  it("runs at the next existing minute when a local hour is skipped (spring forward)", () => {
    // Europe/Berlin 2026-03-29: 02:00 CET → 03:00 CEST, so 02:30 never happens.
    // The run must still happen that day, at 03:00 local (01:00 UTC).
    const next = nextCronRun("30 2 * * *", "Europe/Berlin", Date.parse("2026-03-28T12:00:00Z"));
    expect(iso(next)).toBe("2026-03-29T01:00:00.000Z");

    const local = zonedParts(next!, "Europe/Berlin");
    expect(local.day).toBe(29);
    expect(local.hour).toBe(3);
  });

  it("returns null for a date that never comes", () => {
    // 30 February.
    expect(nextCronRun("0 0 30 2 *", "UTC", Date.parse("2026-01-01T00:00:00Z"))).toBeNull();
  });
});

describe("interval schedules", () => {
  it("runs immediately when it has never run", () => {
    const now = Date.parse("2026-08-25T10:00:00Z");
    expect(nextIntervalRun(30, null, now)).toBe(now);
  });

  it("applies the unattended floor to a too-frequent interval", () => {
    const last = Date.parse("2026-08-25T10:00:00Z");
    expect(iso(nextIntervalRun(1, last, last))).toBe(
      iso(last + MIN_INTERVAL_MINUTES * 60_000)
    );
  });
});

describe("nextRunAt / isDue", () => {
  const policy = { backoffMinutes: 5, backoffCeilingMinutes: 60, pauseAfterConsecutiveFailures: 5 };
  const base = {
    scheduleKind: "interval" as const,
    intervalMinutes: 30,
    cronExpression: null,
    timezone: "UTC",
    enabled: true,
    autoPausedAt: null,
    consecutiveFailures: 0,
    failurePolicy: policy,
  };
  const now = Date.parse("2026-08-25T10:00:00Z");

  it("is not due when disabled or paused, whatever the schedule says", () => {
    expect(nextRunAt({ definition: { ...base, enabled: false }, lastRunAtMs: null, nowMs: now })).toBeNull();
    expect(
      nextRunAt({
        definition: { ...base, autoPausedAt: "2026-08-24T00:00:00.000Z" },
        lastRunAtMs: null,
        nowMs: now,
      })
    ).toBeNull();
    expect(isDue({ definition: { ...base, enabled: false }, lastRunAtMs: null, nowMs: now })).toBe(false);
  });

  it("is due once the interval has elapsed", () => {
    const lastRunAtMs = now - 29 * 60_000;
    expect(isDue({ definition: base, lastRunAtMs, nowMs: now })).toBe(false);
    expect(isDue({ definition: base, lastRunAtMs: now - 31 * 60_000, nowMs: now })).toBe(true);
  });

  it("does not re-fire a cron run inside the minute it just ran", () => {
    const definition = { ...base, scheduleKind: "cron" as const, cronExpression: "0 * * * *", intervalMinutes: null };
    const ranAt = Date.parse("2026-08-25T10:00:00Z");
    expect(iso(nextRunAt({ definition, lastRunAtMs: ranAt, nowMs: ranAt + 1000 }))).toBe(
      "2026-08-25T11:00:00.000Z"
    );
    expect(isDue({ definition, lastRunAtMs: ranAt, nowMs: ranAt + 1000 })).toBe(false);
  });

  it("actually becomes due when a cron occurrence arrives", () => {
    // Regression: due-time was searched from `now`, so the answer was always in
    // the future and no cron automation ever fired.
    const definition = { ...base, scheduleKind: "cron" as const, cronExpression: "0 3 * * *", intervalMinutes: null };
    const yesterday = Date.parse("2026-08-24T03:00:00Z");
    const atThree = Date.parse("2026-08-25T03:00:00Z");

    expect(iso(nextRunAt({ definition, lastRunAtMs: yesterday, nowMs: atThree }))).toBe(
      "2026-08-25T03:00:00.000Z"
    );
    expect(isDue({ definition, lastRunAtMs: yesterday, nowMs: atThree })).toBe(true);
    // A minute before, it is not.
    expect(isDue({ definition, lastRunAtMs: yesterday, nowMs: atThree - 60_000 })).toBe(false);
  });

  it("does not fire a brand-new cron automation immediately", () => {
    const definition = { ...base, scheduleKind: "cron" as const, cronExpression: "0 3 * * *", intervalMinutes: null };
    const noon = Date.parse("2026-08-25T12:00:00Z");
    expect(isDue({ definition, lastRunAtMs: null, nowMs: noon })).toBe(false);
    expect(iso(nextRunAt({ definition, lastRunAtMs: null, nowMs: noon }))).toBe("2026-08-26T03:00:00.000Z");
  });

  it("catches up exactly once after an outage, not once per missed day", () => {
    const definition = { ...base, scheduleKind: "cron" as const, cronExpression: "0 3 * * *", intervalMinutes: null };
    const lastRun = Date.parse("2026-08-22T03:00:00Z");
    const backUp = Date.parse("2026-08-25T12:00:00Z");

    expect(isDue({ definition, lastRunAtMs: lastRun, nowMs: backUp })).toBe(true);
    // After the catch-up run, the next occurrence is in the future again.
    expect(isDue({ definition, lastRunAtMs: backUp, nowMs: backUp + 1000 })).toBe(false);
  });

  it("holds a failing automation back for its backoff, not just on paper", () => {
    // Regression: the backoff was written to next_run_at but selection
    // recomputed the schedule and ignored it, so a broken 15-minute automation
    // retried every 15 minutes regardless.
    const definition = { ...base, intervalMinutes: 15, consecutiveFailures: 3 };
    const failedAt = Date.parse("2026-08-25T10:00:00Z");

    // Schedule alone says 10:15; backoff (5 × 2² = 20 min) says 10:20.
    expect(isDue({ definition, lastRunAtMs: failedAt, nowMs: failedAt + 16 * 60_000 })).toBe(false);
    expect(isDue({ definition, lastRunAtMs: failedAt, nowMs: failedAt + 21 * 60_000 })).toBe(true);
    expect(iso(effectiveNextRunAt({ definition, lastRunAtMs: failedAt, nowMs: failedAt }))).toBe(
      "2026-08-25T10:20:00.000Z"
    );
  });

  it("backs off further each failure, up to the ceiling", () => {
    expect(backoffDelayMinutes(0, policy)).toBe(0);
    expect(backoffDelayMinutes(1, policy)).toBe(5);
    expect(backoffDelayMinutes(2, policy)).toBe(10);
    expect(backoffDelayMinutes(3, policy)).toBe(20);
    expect(backoffDelayMinutes(10, policy)).toBe(60);
  });

  it("treats an unparseable cron expression as never due rather than throwing", () => {
    const definition = { ...base, scheduleKind: "cron" as const, cronExpression: "not a cron", intervalMinutes: null };
    expect(nextRunAt({ definition, lastRunAtMs: null, nowMs: now })).toBeNull();
    expect(isDue({ definition, lastRunAtMs: null, nowMs: now })).toBe(false);
  });
});

describe("plain-language schedules", () => {
  it("describes intervals", () => {
    expect(describeSchedule({ scheduleKind: "interval", intervalMinutes: 30, cronExpression: null, timezone: "UTC" })).toBe(
      "Every 30 minutes"
    );
    expect(describeSchedule({ scheduleKind: "interval", intervalMinutes: 60, cronExpression: null, timezone: "UTC" })).toBe(
      "Every hour"
    );
    expect(describeSchedule({ scheduleKind: "interval", intervalMinutes: 240, cronExpression: null, timezone: "UTC" })).toBe(
      "Every 4 hours"
    );
    // The floor is described honestly, not as the user typed it.
    expect(describeSchedule({ scheduleKind: "interval", intervalMinutes: 5, cronExpression: null, timezone: "UTC" })).toBe(
      "Every 15 minutes"
    );
  });

  it("describes common cron shapes and falls back to the expression otherwise", () => {
    expect(describeCronExpression("0 6 * * *")).toBe("Daily at 06:00");
    expect(describeCronExpression("30 7 * * 1")).toBe("Monday at 07:30");
    expect(describeCronExpression("0 * * * *")).toBe("Hourly at :00");
    expect(describeCronExpression("* * * * *")).toBe("Every minute");
    // Nothing plausible to say: show the expression rather than guess wrong.
    expect(describeCronExpression("*/7 3 5 1 2")).toBe("*/7 3 5 1 2");
  });

  it("names the zone, because 06:00 means nothing without one", () => {
    expect(
      describeSchedule({
        scheduleKind: "cron",
        intervalMinutes: null,
        cronExpression: "0 6 * * *",
        timezone: "Asia/Dubai",
      })
    ).toBe("Daily at 06:00 (Asia/Dubai)");
  });
});
