import { computeUnattendedStatus, nextRunPhrase, type UnattendedStatusInput } from "./unattendedStatus";

const base: UnattendedStatusInput = {
  reviewPolicy: "auto_sync_unattended",
  flowEnabled: true,
  autoPaused: false,
  vaultReady: true,
  bothEnrolled: true,
  lastRunAtMs: null,
  intervalMinutes: 15,
  nowMs: 1_000_000_000_000,
};

describe("computeUnattendedStatus", () => {
  it("is not unattended for other policies", () => {
    expect(computeUnattendedStatus({ ...base, reviewPolicy: "manual_preview_required" }).isUnattended).toBe(false);
  });

  it("is never armed while the vault state is unknown", () => {
    const s = computeUnattendedStatus({ ...base, vaultReady: null });
    expect(s.armed).toBe(false);
    expect(s.nextRunAtMs).toBeNull();
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
    expect(computeUnattendedStatus({ ...base, vaultReady: false }).reason).toMatch(/locked/);
    expect(computeUnattendedStatus({ ...base, vaultReady: null }).reason).toMatch(/not confirmed/);
    expect(computeUnattendedStatus({ ...base, bothEnrolled: false }).reason).toMatch(/Store credentials/);
  });

  it("is not armed when the engine has health-paused the flow's automation", () => {
    // The flow itself is enabled and perfectly configured - the reason it is
    // not running lives on the automation, which nothing writes back onto the
    // flow. Read it or this panel says "Armed" about a flow that will not run.
    const s = computeUnattendedStatus({
      ...base,
      enginePause: { reason: "5 consecutive failures" },
    });

    expect(s.paused).toBe(true);
    expect(s.armed).toBe(false);
    expect(s.nextRunAtMs).toBeNull();
    // In the engine's words, and pointing at the page that can undo it: the
    // Sync page's own "re-enable the flow" would not clear this pause.
    expect(s.reason).toBe("Paused by automation: 5 consecutive failures");
  });

  it("still says something actionable when the engine gave no pause reason", () => {
    const s = computeUnattendedStatus({ ...base, enginePause: { reason: null } });
    expect(s.armed).toBe(false);
    expect(s.reason).toMatch(/Automations page/);
  });

  it("prefers the flow's own pause, which the Sync page can actually undo", () => {
    const s = computeUnattendedStatus({
      ...base,
      flowEnabled: false,
      enginePause: { reason: "5 consecutive failures" },
    });
    expect(s.reason).toBe("Paused - re-enable the flow to resume");
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
    expect(nextRunPhrase(computeUnattendedStatus({ ...base, vaultReady: false }), base.nowMs)).toMatch(/locked/);
  });
});
