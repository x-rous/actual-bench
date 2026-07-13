import {
  classificationGroup,
  filterCount,
  formatAmount,
  isReviewRequired,
  matchesPreviewFilter,
  previewFilters,
  previewTiles,
  reviewQueueCount,
  reviewQueueRows,
  selectableRowIds,
  splitPositions,
  statusLabel,
  syncKindOf,
  targetEntityDisplay,
  toPreviewRow,
} from "./previewRows";
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

  it("makes opt-in update and review-first delete rows selectable (RD-057)", () => {
    const upd = toPreviewRow(item({ classification: "source_changed_since_sync", plannedAction: "update" }));
    expect(upd.selectable).toBe(true);
    expect(upd.isSafeNew).toBe(false);
    expect(upd.group).toBe("source_changed");
    const del = toPreviewRow(item({ classification: "source_missing", plannedAction: "delete" }));
    expect(del.selectable).toBe(true);
    expect(del.isSafeNew).toBe(false);
    expect(del.group).toBe("source_deleted");
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

describe("review queue (RD-054)", () => {
  it("classifies only uncertain, non-safe, non-resolved items as review-required", () => {
    expect(isReviewRequired("exact_duplicate")).toBe(true);
    expect(isReviewRequired("strong_duplicate")).toBe(true);
    expect(isReviewRequired("weak_duplicate")).toBe(true);
    expect(isReviewRequired("source_changed_since_sync")).toBe(true);
    expect(isReviewRequired("source_missing")).toBe(true);
    expect(isReviewRequired("blocked")).toBe(true);
    expect(isReviewRequired("warning")).toBe(true);
    // Safe (auto-applied) and resolved classes are NOT review-required.
    expect(isReviewRequired("new")).toBe(false);
    expect(isReviewRequired("target_marker_match")).toBe(false);
    expect(isReviewRequired("already_synced")).toBe(false);
    expect(isReviewRequired(null)).toBe(false);
  });

  it("queues review-required pending rows and never the auto-applied safe set", () => {
    const rows = [
      toPreviewRow(item({ id: "new-1", classification: "new" })),
      toPreviewRow(item({ id: "mm-1", classification: "target_marker_match" })),
      toPreviewRow(item({ id: "dup-1", classification: "strong_duplicate", plannedAction: "skip", applyState: "pending" })),
      toPreviewRow(item({ id: "chg-1", classification: "source_changed_since_sync", applyState: null })),
      toPreviewRow(item({ id: "blk-1", classification: "blocked", plannedAction: "blocked" })),
      toPreviewRow(item({ id: "done-1", classification: "already_synced", plannedAction: "skip" })),
    ];
    const queued = reviewQueueRows(rows).map((r) => r.id).sort();
    expect(queued).toEqual(["blk-1", "chg-1", "dup-1"]);
    expect(reviewQueueCount(rows)).toBe(3);
    // The safe set (new + marker-match) is exactly what automation applies - never queued.
    expect(queued).not.toContain("new-1");
    expect(queued).not.toContain("mm-1");
  });

  it("drops items once they have been applied or skipped by a human", () => {
    const applied = toPreviewRow(item({ id: "dup-applied", classification: "exact_duplicate", applyState: "applied" }));
    const skipped = toPreviewRow(item({ id: "dup-skipped", classification: "weak_duplicate", applyState: "skipped" }));
    const pending = toPreviewRow(item({ id: "dup-pending", classification: "weak_duplicate", applyState: "pending" }));
    expect(reviewQueueRows([applied, skipped, pending]).map((r) => r.id)).toEqual(["dup-pending"]);
  });

  it("treats an auto-mapped exact duplicate as safe: selectable, not queued", () => {
    const autoMap = toPreviewRow(item({
      classification: "exact_duplicate",
      plannedAction: "skip",
      warnings: { version: 1, data: { flags: ["exact_duplicate_auto_map"] } },
    }));
    expect(autoMap.selectable).toBe(true);
    expect(autoMap.reviewRequired).toBe(false);
    expect(reviewQueueRows([autoMap])).toHaveLength(0);

    // Without the flag, the same exact duplicate stays review-required.
    const review = toPreviewRow(item({ classification: "exact_duplicate", plannedAction: "skip", warnings: { version: 1, data: { flags: ["duplicate_review"] } } }));
    expect(review.reviewRequired).toBe(true);
    expect(review.selectable).toBe(false);
  });

  it("matches the review_queue filter for pending review-required rows only", () => {
    const dup = toPreviewRow(item({ classification: "strong_duplicate", applyState: "pending" }));
    const dupApplied = toPreviewRow(item({ classification: "strong_duplicate", applyState: "applied" }));
    const fresh = toPreviewRow(item({ classification: "new" }));
    expect(matchesPreviewFilter(dup, "review_queue")).toBe(true);
    expect(matchesPreviewFilter(dupApplied, "review_queue")).toBe(false);
    expect(matchesPreviewFilter(fresh, "review_queue")).toBe(false);
  });
});

describe("kind-aware rendering (RD-055 UI)", () => {
  it("maps flow types to a data-type kind", () => {
    expect(syncKindOf("transaction_sync")).toBe("transaction");
    expect(syncKindOf("payee_sync")).toBe("payee");
    expect(syncKindOf("category_sync")).toBe("category");
  });

  it("carries the entity type onto the row", () => {
    expect(toPreviewRow(item({ sourceEntityType: "payee" })).entityType).toBe("payee");
    expect(toPreviewRow(item()).entityType).toBe("transaction");
  });

  it("labels an entity name match as 'Name match', not 'Marker match'", () => {
    const row = toPreviewRow(item({ sourceEntityType: "payee", classification: "target_name_match" }));
    expect(statusLabel(row)).toBe("Name match");
    expect(statusLabel(toPreviewRow(item({ classification: "new" })))).toBe("New");
  });

  it("words tiles and filters per data type", () => {
    const rows = [toPreviewRow(item({ sourceEntityType: "payee", classification: "new" }))];
    const txn = previewTiles(rows, "transaction").map((t) => t.label);
    expect(txn).toContain("Needs review");
    const payee = previewTiles(rows, "payee").map((t) => t.label);
    expect(payee).toContain("New payees");
    expect(payee).not.toContain("Needs review");
    // Entity filters drop transaction-only groups.
    expect(previewFilters("payee").map((f) => f.key)).not.toContain("duplicate");
    expect(previewFilters("transaction").map((f) => f.key)).toContain("duplicate");
  });
});

describe("transaction preview clarity (PR-025g)", () => {
  function withFlags(flags: string[], overrides: Partial<SyncFlowRunItem> = {}) {
    return toPreviewRow(item({ warnings: { version: 1, data: { flags } }, ...overrides }));
  }

  it("carries structured FX info from the planned payload", () => {
    const row = toPreviewRow(item({
      plannedTargetPayload: {
        version: 1,
        data: { date: "2026-07-01", amount: -520, payeeName: "Coffee Bar", categoryId: "tc1", notes: "n",
          fx: { sourceCurrency: "AED", targetCurrency: "AUD", rate: "0.4162", effectiveDate: "2026-06-30" } },
      },
    }));
    expect(row.fx).toEqual({ sourceCurrency: "AED", targetCurrency: "AUD", rate: "0.4162", effectiveDate: "2026-06-30" });
  });

  it("drops FX info when the payload lacks a complete rate", () => {
    expect(toPreviewRow(item()).fx).toBeNull();
  });

  it("labels FX-pending and rate-changed rows distinctly", () => {
    expect(statusLabel(withFlags(["fx_rate_pending"]))).toBe("FX pending");
    expect(statusLabel(withFlags(["fx_rate_changed"]))).toBe("Rate changed");
  });

  it("resolves payee/category display from match-by-name and missing flags", () => {
    expect(targetEntityDisplay("Coffee Bar", [], "payee")).toEqual({ name: "Coffee Bar", state: "matched" });
    expect(targetEntityDisplay("Coffee Bar", ["missing_payee_created_on_apply"], "payee")).toEqual({ name: "Coffee Bar", state: "new" });
    // Source has a payee but it won't map (auto-create off): keep the name, mark unmatched.
    expect(targetEntityDisplay("Coffee Bar", ["missing_payee_left_empty"], "payee")).toEqual({ name: "Coffee Bar", state: "unmatched" });
    // Source has a category with no target match: keep the name, mark unmatched.
    expect(targetEntityDisplay("Dining", ["missing_category_left_empty"], "category")).toEqual({ name: "Dining", state: "unmatched" });
    // Genuinely empty source field.
    expect(targetEntityDisplay(null, [], "category")).toEqual({ name: "", state: "none" });
  });

  it("no longer maps a raw category id as the target category name", () => {
    expect(toPreviewRow(item()).target.categoryName).toBeNull();
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
