import { classificationGroup, filterCount, formatAmount, selectableRowIds, splitPositions, toPreviewRow } from "./previewRows";
import type { SyncFlowRunItem } from "@/lib/app-db/types";

function item(overrides: Partial<SyncFlowRunItem> = {}): SyncFlowRunItem {
  return {
    id: "i1", runId: "r1", flowId: "f1", legId: null, sequence: 0,
    sourceItemRef: {
      version: 1,
      data: { itemKey: "txn:t1", source: { date: "2026-07-01", amount: -1250, payeeName: "Coffee Bar", categoryName: "Dining", notes: "x" } },
    },
    targetItemRef: null, status: "planned", message: null,
    sourceEntityType: "transaction", sourceItemKey: "txn:t1",
    sourceTransactionId: "t1", sourceSplitId: null, sourceFingerprint: "fp",
    plannedAction: "create",
    plannedTargetPayload: { version: 1, data: { date: "2026-07-01", amount: 1250, payeeName: "Coffee Bar", categoryId: "tc1", notes: "n" } },
    classification: "new", duplicateConfidence: "none",
    warnings: { version: 1, data: { flags: ["target_rules_may_modify"] } }, errors: null,
    selectedForApply: true, applyState: "pending",
    createdTargetTransactionId: null, createdTargetMarker: null,
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: null,
    ...overrides,
  };
}

describe("toPreviewRow", () => {
  it("reads source and target sides from the persisted envelopes", () => {
    const row = toPreviewRow(item());
    expect(row.source).toMatchObject({ date: "2026-07-01", amount: -1250, payeeName: "Coffee Bar" });
    expect(row.target).toMatchObject({ date: "2026-07-01", amount: 1250, payeeName: "Coffee Bar" });
    expect(row.flags).toContain("target_rules_may_modify");
    expect(row.group).toBe("new");
    expect(row.selectable).toBe(true);
  });

  it("marks split-line items and controls selectability", () => {
    expect(toPreviewRow(item({ sourceEntityType: "split_line" })).isSplit).toBe(true);
    expect(toPreviewRow(item({ classification: "already_synced", plannedAction: "skip" })).selectable).toBe(false);
    expect(toPreviewRow(item({ classification: "blocked", plannedAction: "blocked" })).selectable).toBe(false);
  });

  it("makes marker-match rows selectable for repair but not part of safe-new", () => {
    const row = toPreviewRow(item({ classification: "target_marker_match", plannedAction: "skip" }));
    expect(row.selectable).toBe(true);
    expect(row.isSafeNew).toBe(false);
  });
});

describe("classificationGroup", () => {
  it("groups duplicates and maps lifecycle states", () => {
    expect(classificationGroup("exact_duplicate")).toBe("duplicate");
    expect(classificationGroup("strong_duplicate")).toBe("duplicate");
    expect(classificationGroup("source_changed_since_sync")).toBe("source_changed");
    expect(classificationGroup("target_marker_match")).toBe("marker_match");
    expect(classificationGroup("blocked")).toBe("blocked");
  });
});

describe("selectableRowIds", () => {
  it("returns only safe-new ids (excludes blocked and marker-match)", () => {
    const rows = [
      toPreviewRow(item({ id: "a" })),
      toPreviewRow(item({ id: "b", classification: "blocked", plannedAction: "blocked" })),
      toPreviewRow(item({ id: "c", classification: "target_marker_match", plannedAction: "skip" })),
    ];
    expect(selectableRowIds(rows)).toEqual(["a"]);
  });
});

describe("filterCount", () => {
  it("counts by group, with needs_review spanning the review groups", () => {
    const rows = [
      toPreviewRow(item({ id: "a", classification: "new" })),
      toPreviewRow(item({ id: "b", classification: "exact_duplicate", plannedAction: "skip" })),
      toPreviewRow(item({ id: "c", classification: "source_changed_since_sync", plannedAction: "skip" })),
    ];
    expect(filterCount(rows, "all")).toBe(3);
    expect(filterCount(rows, "new")).toBe(1);
    expect(filterCount(rows, "needs_review")).toBe(2);
    expect(filterCount(rows, "blocked")).toBe(0);
  });
});

describe("splitPositions", () => {
  it("numbers split lines within their parent transaction", () => {
    const rows = [
      toPreviewRow(item({ id: "s1", sourceEntityType: "split_line", sourceItemKey: "split:p:a" })),
      toPreviewRow(item({ id: "s2", sourceEntityType: "split_line", sourceItemKey: "split:p:b" })),
      toPreviewRow(item({ id: "n1", sourceEntityType: "transaction", sourceItemKey: "txn:t1" })),
    ];
    const pos = splitPositions(rows);
    expect(pos.get("s1")).toEqual({ index: 1, total: 2 });
    expect(pos.get("s2")).toEqual({ index: 2, total: 2 });
    expect(pos.get("n1")).toBeUndefined();
  });
});

describe("formatAmount", () => {
  it("formats minor units with sign and thousands grouping", () => {
    expect(formatAmount(-1250)).toBe("-12.50");
    expect(formatAmount(1205)).toBe("12.05");
    expect(formatAmount(-125000)).toBe("-1,250.00");
    expect(formatAmount(null)).toBe("-");
  });
});
