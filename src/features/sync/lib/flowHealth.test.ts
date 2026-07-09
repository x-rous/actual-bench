import {
  classifySafeSyncOutcome,
  DEFAULT_HEALTH_PAUSE_THRESHOLD,
  nextConsecutiveFailures,
  shouldPauseForHealth,
} from "./flowHealth";

describe("classifySafeSyncOutcome", () => {
  it("treats clean applies and no-op runs as success", () => {
    expect(classifySafeSyncOutcome("applied")).toBe("success");
    expect(classifySafeSyncOutcome("no_safe_items")).toBe("success");
  });

  it("treats failed, partial, and preview failures as failure", () => {
    expect(classifySafeSyncOutcome("failed")).toBe("failure");
    expect(classifySafeSyncOutcome("partial")).toBe("failure");
    expect(classifySafeSyncOutcome("preview_failed")).toBe("failure");
  });

  it("ignores a manual-policy skip (not an auto run)", () => {
    expect(classifySafeSyncOutcome("skipped_manual_policy")).toBe("ignored");
  });
});

describe("consecutive-failure streak", () => {
  it("increments on failure, resets on success, holds on ignored", () => {
    expect(nextConsecutiveFailures(0, "failure")).toBe(1);
    expect(nextConsecutiveFailures(2, "failure")).toBe(3);
    expect(nextConsecutiveFailures(2, "success")).toBe(0);
    expect(nextConsecutiveFailures(2, "ignored")).toBe(2);
  });

  it("pauses only once the streak reaches the threshold (default 3)", () => {
    expect(DEFAULT_HEALTH_PAUSE_THRESHOLD).toBe(3);
    expect(shouldPauseForHealth(2)).toBe(false);
    expect(shouldPauseForHealth(3)).toBe(true);
    expect(shouldPauseForHealth(4)).toBe(true);
  });

  it("simulates three consecutive failures pausing the flow, and a success clearing it", () => {
    let streak = 0;
    for (const status of ["failed", "partial", "failed"] as const) {
      streak = nextConsecutiveFailures(streak, classifySafeSyncOutcome(status));
    }
    expect(shouldPauseForHealth(streak)).toBe(true);

    // A later successful run resets the streak below the threshold again.
    streak = nextConsecutiveFailures(streak, classifySafeSyncOutcome("applied"));
    expect(streak).toBe(0);
    expect(shouldPauseForHealth(streak)).toBe(false);
  });

  it("does not pause when failures are interrupted by a success", () => {
    let streak = 0;
    for (const status of ["failed", "failed", "applied", "failed"] as const) {
      streak = nextConsecutiveFailures(streak, classifySafeSyncOutcome(status));
    }
    expect(streak).toBe(1);
    expect(shouldPauseForHealth(streak)).toBe(false);
  });
});
