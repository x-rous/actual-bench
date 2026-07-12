import { computeUnattendedStatus, nextRunPhrase, type UnattendedStatusInput } from "./unattendedStatus";

const base: UnattendedStatusInput = {
  reviewPolicy: "auto_sync_unattended",
  flowEnabled: true,
  autoPaused: false,
  vaultEnabled: true,
  bothHttp: true,
  bothEnrolled: true,
  lastRunAtMs: null,
  intervalMinutes: 15,
  nowMs: 1_000_000_000_000,
};

describe("computeUnattendedStatus", () => {
  it("is not unattended for other policies", () => {
    expect(computeUnattendedStatus({ ...base, reviewPolicy: "manual_preview_required" }).isUnattended).toBe(false);
  });

  it("is armed when vault + http + enrolled + active", () => {
    const s = computeUnattendedStatus(base);
    expect(s.armed).toBe(true);
    expect(s.reason).toBeNull();
    expect(s.nextRunAtMs).toBeNull(); // never run → next check
  });

  it("reports the first blocking reason in priority order", () => {
    expect(computeUnattendedStatus({ ...base, autoPaused: true }).reason).toMatch(/Paused/);
    expect(computeUnattendedStatus({ ...base, flowEnabled: false }).reason).toMatch(/Paused/);
    expect(computeUnattendedStatus({ ...base, vaultEnabled: false }).reason).toMatch(/vault/);
    expect(computeUnattendedStatus({ ...base, bothHttp: false }).reason).toMatch(/HTTP API/);
    expect(computeUnattendedStatus({ ...base, bothEnrolled: false }).reason).toMatch(/Store credentials/);
  });

  it("computes the next run from last run + interval floor", () => {
    // 15-min interval, last run 5 min ago → future.
    const s = computeUnattendedStatus({ ...base, lastRunAtMs: base.nowMs - 5 * 60_000 });
    expect(s.nextRunAtMs).toBe(base.nowMs - 5 * 60_000 + 15 * 60_000);
    // Interval below the floor is clamped to 15 min.
    const clamped = computeUnattendedStatus({ ...base, intervalMinutes: 1, lastRunAtMs: base.nowMs - 5 * 60_000 });
    expect(clamped.nextRunAtMs).toBe(base.nowMs - 5 * 60_000 + 15 * 60_000);
  });

  it("treats an overdue flow as due on the next check", () => {
    const s = computeUnattendedStatus({ ...base, lastRunAtMs: base.nowMs - 30 * 60_000 });
    expect(s.nextRunAtMs).toBeNull();
  });

  it("never computes a next run when not armed", () => {
    expect(computeUnattendedStatus({ ...base, bothEnrolled: false, lastRunAtMs: base.nowMs }).nextRunAtMs).toBeNull();
  });
});

describe("nextRunPhrase", () => {
  it("phrases soon / scheduled / blocked", () => {
    expect(nextRunPhrase(computeUnattendedStatus(base), base.nowMs)).toMatch(/next check/);
    expect(nextRunPhrase(computeUnattendedStatus({ ...base, lastRunAtMs: base.nowMs - 5 * 60_000 }), base.nowMs)).toMatch(/~10 min/);
    expect(nextRunPhrase(computeUnattendedStatus({ ...base, vaultEnabled: false }), base.nowMs)).toMatch(/vault/);
  });
});
