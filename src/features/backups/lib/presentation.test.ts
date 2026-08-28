import { relativeTime, describeSchedule } from "./presentation";
import type { BackupPolicy } from "@/lib/app-db/backupRepository";

function policy(overrides: Partial<BackupPolicy> = {}): BackupPolicy {
  return {
    id: "pol-1",
    name: "Nightly",
    enabled: true,
    contents: "both",
    sourceRef: { version: 1, data: {} },
    destinationIds: [],
    verificationLevel: "data",
    encryption: "none",
    encryptionCredentialRef: null,
    retention: {
      daily: 7,
      weekly: 4,
      monthly: 12,
      yearly: 3,
      minimumAgeHours: 24,
      autoProtectionDays: 14,
      autoProtectionCount: 10,
    },
    scheduleKind: "cron",
    cronExpression: "0 2 * * *",
    intervalMinutes: null,
    timezone: "UTC",
    scrubEnabled: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const NOW = new Date("2026-08-28T12:00:00.000Z");

describe("relative time in both directions", () => {
  it("reads the past as the past", () => {
    expect(relativeTime("2026-08-28T09:00:00.000Z", NOW)).toBe("3h ago");
    expect(relativeTime("2026-08-26T12:00:00.000Z", NOW)).toBe("2d ago");
  });

  it("reads the future as the future", () => {
    // A schedule set for tonight used to read "just now", because anything not
    // in the past fell through the "less than a minute" branch.
    expect(relativeTime("2026-08-28T20:00:00.000Z", NOW)).toBe("in 8h");
    expect(relativeTime("2026-08-29T12:00:00.000Z", NOW)).toBe("in 1d");
  });

  it("still says just now for right now, and never for nothing", () => {
    expect(relativeTime("2026-08-28T12:00:10.000Z", NOW)).toBe("just now");
    expect(relativeTime(null, NOW)).toBe("never");
  });
});

describe("describing a schedule", () => {
  it("says the time somebody chose, not the cron they never typed", () => {
    expect(describeSchedule(policy({ cronExpression: "0 20 * * *", timezone: "Asia/Dubai" }))).toBe(
      "Daily at 20:00 (Asia/Dubai)"
    );
    expect(describeSchedule(policy({ cronExpression: "30 6 * * 1,4" }))).toBe(
      "Monday and Thursday at 06:30"
    );
  });

  it("leaves the time zone off when it is UTC, since that says nothing", () => {
    expect(describeSchedule(policy({ cronExpression: "0 2 * * *" }))).toBe("Daily at 02:00");
  });

  it("describes an interval in the units it was set in", () => {
    expect(describeSchedule(policy({ scheduleKind: "interval", intervalMinutes: 360 }))).toBe(
      "Every 6 hour(s)"
    );
    expect(describeSchedule(policy({ scheduleKind: "interval", intervalMinutes: 2880 }))).toBe(
      "Every 2 day(s)"
    );
  });
});
