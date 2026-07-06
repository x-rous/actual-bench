import { classificationGroup, formatAmount, selectableRowIds, toPreviewRow } from "./previewRows";
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

  it("marks split-line items and only new items selectable", () => {
    expect(toPreviewRow(item({ sourceEntityType: "split_line" })).isSplit).toBe(true);
    expect(toPreviewRow(item({ classification: "already_synced", plannedAction: "skip" })).selectable).toBe(false);
    expect(toPreviewRow(item({ classification: "blocked", plannedAction: "blocked" })).selectable).toBe(false);
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
  it("returns only selectable ids", () => {
    const rows = [toPreviewRow(item({ id: "a" })), toPreviewRow(item({ id: "b", classification: "blocked", plannedAction: "blocked" }))];
    expect(selectableRowIds(rows)).toEqual(["a"]);
  });
});

describe("formatAmount", () => {
  it("formats minor units with sign", () => {
    expect(formatAmount(-1250)).toBe("-12.50");
    expect(formatAmount(1205)).toBe("12.05");
    expect(formatAmount(null)).toBe("—");
  });
});
