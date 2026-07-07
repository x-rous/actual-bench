import { latestRunLabel, toRunRow } from "./runsView";
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
    expect(toRunRow(run({ createdByTrigger: "background_future" })).trigger).toBe("Automated");
  });
});

describe("latestRunLabel", () => {
  it("summarizes the latest run or reports none", () => {
    expect(latestRunLabel(undefined)).toBe("No runs yet");
    expect(latestRunLabel(run({ status: "applied" }))).toMatch(/^Synced · /);
  });
});
