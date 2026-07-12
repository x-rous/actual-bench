import {
  isAutoRun,
  latestRunLabel,
  runAutoAppliedCount,
  runNeedsAttention,
  runQueuedCount,
  runResultSummary,
  toRunRow,
} from "./runsView";
import type { SyncFlowRun } from "@/lib/app-db/types";

function run(overrides: Partial<SyncFlowRun> = {}): SyncFlowRun {
  return {
    id: "r1", flowId: "f1", status: "draft_preview",
    startedAt: "2026-07-01T00:00:00.000Z", finishedAt: null,
    summary: { version: 1, data: { totalItems: 33 } }, error: null,
    createdByTrigger: "manual_preview", sourceSnapshotSummary: null, targetSnapshotSummary: null, counts: null,
    ...overrides,
  };
}

describe("runResultSummary", () => {
  const summary = (data: Record<string, number>) => ({ version: 1 as const, data });

  it("always shows scanned/new/synced and appends non-zero classes", () => {
    const r = run({
      status: "applied",
      counts: { version: 1, data: { applied: 3, failed: 0 } },
      summary: summary({ sourceItemsScanned: 31, createCandidates: 3, alreadySynced: 24, targetMarkerMatches: 2, duplicatesSkipped: 2 }),
    });
    expect(runResultSummary(r)).toBe("31 scanned · 3 new · 26 synced · 2 dup");
  });

  it("reads a no-changes automated run as all already-synced", () => {
    const r = run({
      status: "no_changes",
      summary: summary({ sourceItemsScanned: 24, createCandidates: 0, alreadySynced: 24 }),
    });
    expect(runResultSummary(r)).toBe("24 scanned · 0 new · 24 synced");
  });

  it("shows the failure reason instead of counts for a failed run", () => {
    const r = run({ status: "failed", error: { version: 1, data: { code: "target_open_failed", message: "Failed to open the target budget" } } });
    expect(runResultSummary(r)).toMatch(/target/i);
  });
});

describe("toRunRow", () => {
  it("maps a draft preview run (no apply counts yet)", () => {
    const r = toRunRow(run());
    expect(r).toMatchObject({ statusLabel: "Preview only", tone: "neutral", trigger: "Manual", planned: 33, created: null });
  });

  it("maps an applied run with counts", () => {
    const r = toRunRow(run({ status: "applied", counts: { version: 1, data: { applied: 8, repaired: 1, failed: 0 } } }));
    expect(r).toMatchObject({ statusLabel: "Synced", tone: "good", planned: 33, created: 8, relinked: 1, failed: 0 });
  });

  it("marks a background run as automated", () => {
    const r = toRunRow(run({ createdByTrigger: "interval_safe_only" }));
    expect(r.trigger).toBe("Auto-sync");
    expect(r.isAuto).toBe(true);
  });

  it("exposes the review-queue count from the preview summary", () => {
    const r = toRunRow(run({
      status: "applied",
      counts: { version: 1, data: { applied: 5, repaired: 0, failed: 0 } },
      summary: { version: 1, data: { totalItems: 12, duplicatesSkipped: 2, sourceChangedWarnings: 1, blocked: 1 } },
    }));
    expect(r.queued).toBe(4);
  });
});

describe("run summary helpers (RD-054)", () => {
  it("isAutoRun distinguishes automated runs", () => {
    expect(isAutoRun(run({ createdByTrigger: "interval_safe_only" }))).toBe(true);
    expect(isAutoRun(run({ createdByTrigger: "manual_preview" }))).toBe(false);
  });

  it("runQueuedCount sums the review-required summary fields", () => {
    expect(runQueuedCount(run({ summary: { version: 1, data: { duplicatesSkipped: 3, sourceChangedWarnings: 2, blocked: 1 } } }))).toBe(6);
    expect(runQueuedCount(run({ summary: null as unknown as SyncFlowRun["summary"] }))).toBe(0);
  });

  it("runAutoAppliedCount adds creates and repairs", () => {
    expect(runAutoAppliedCount(run({ counts: { version: 1, data: { applied: 4, repaired: 3 } } }))).toBe(7);
  });

  it("runNeedsAttention flags failed/partial runs or queued items", () => {
    expect(runNeedsAttention(run({ status: "failed" }))).toBe(true);
    expect(runNeedsAttention(run({ status: "partial" }))).toBe(true);
    expect(runNeedsAttention(run({ status: "applied", summary: { version: 1, data: { blocked: 2 } } }))).toBe(true);
    expect(runNeedsAttention(run({ status: "applied", summary: { version: 1, data: { totalItems: 3 } } }))).toBe(false);
  });
});

describe("latestRunLabel", () => {
  it("summarizes the latest run or reports none", () => {
    expect(latestRunLabel(undefined)).toBe("No runs yet");
    expect(latestRunLabel(run({ status: "applied" }))).toMatch(/^Synced · /);
  });
});
