import type { SyncApplyState, SyncFlowRunItem, SyncItemClassification } from "@/lib/app-db/types";

/**
 * Read persisted run items into display rows for the preview table
 * (RD-053 / PR-019 Slice 5). Pure and UI-agnostic so it can be unit-tested.
 */

export type PreviewGroup =
  | "new"
  | "already_synced"
  | "duplicate"
  | "source_changed"
  | "source_deleted"
  | "marker_match"
  | "blocked"
  | "other";

/** The data type a sync flow operates on, for kind-aware rendering. */
export type SyncKind = "transaction" | "payee" | "category";

export function syncKindOf(flowType: string): SyncKind {
  if (flowType === "payee_sync") return "payee";
  if (flowType === "category_sync") return "category";
  return "transaction";
}

export type PreviewRow = {
  id: string;
  classification: SyncItemClassification | null;
  /** What apply would do (create/update/delete/skip); drives selectability. */
  plannedAction: string | null;
  /** Data type of the item, for kind-aware columns/labels. */
  entityType: "payee" | "category" | "transaction";
  group: PreviewGroup;
  /** Checkbox-enabled: safe-new create candidates or repairable marker matches. */
  selectable: boolean;
  /** Included in "select all safe new" (new create candidates only). */
  isSafeNew: boolean;
  /**
   * Item an automated safe-only run could not apply and left for a human
   * (RD-054 review queue): an uncertain class that is neither safe (new /
   * marker-match) nor already resolved (already-synced).
   */
  reviewRequired: boolean;
  /** Persisted apply lifecycle state (null on a never-applied draft preview). */
  applyState: SyncApplyState | null;
  sourceItemKey: string;
  isSplit: boolean;
  flags: string[];
  message: string | null;
  source: { date: string; amount: number | null; payeeName: string | null; categoryName: string | null; notes: string | null };
  target: { date: string; amount: number | null; payeeName: string | null; categoryName: string | null; notes: string | null };
  /** FX conversion applied to this row (RD-056), for currency-labelled amounts + rate. */
  fx: { sourceCurrency: string; targetCurrency: string; rate: string; effectiveDate: string } | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Classes a safe-only automated run cannot apply and routes to the review queue
 * (RD-054). Deliberately excludes `new` and `target_marker_match` (both safe →
 * auto-applied) and `already_synced` (already resolved, no action needed).
 */
const REVIEW_REQUIRED_CLASSIFICATIONS: readonly SyncItemClassification[] = [
  "exact_duplicate",
  "strong_duplicate",
  "weak_duplicate",
  "source_changed_since_sync",
  "source_missing",
  "blocked",
  "warning",
];

export function isReviewRequired(classification: SyncItemClassification | null): boolean {
  return classification != null && REVIEW_REQUIRED_CLASSIFICATIONS.includes(classification);
}

export function classificationGroup(classification: SyncItemClassification | null): PreviewGroup {
  switch (classification) {
    case "new":
      return "new";
    case "already_synced":
      return "already_synced";
    case "exact_duplicate":
    case "strong_duplicate":
    case "weak_duplicate":
      return "duplicate";
    case "source_changed_since_sync":
      return "source_changed";
    case "source_missing":
      return "source_deleted";
    case "target_marker_match":
    case "target_name_match":
      return "marker_match";
    case "blocked":
      return "blocked";
    default:
      return "other";
  }
}

export function toPreviewRow(item: SyncFlowRunItem): PreviewRow {
  const sourceRef = record(item.sourceItemRef?.data);
  const source = record(sourceRef.source);
  const payload = record(item.plannedTargetPayload?.data);
  const flags = Array.isArray(record(item.warnings?.data).flags)
    ? ((record(item.warnings?.data).flags as unknown[]).filter((f): f is string => typeof f === "string"))
    : [];

  const isSafeNew = item.classification === "new" && item.plannedAction === "create";
  // An exact duplicate the flow opted to auto-map is safe (mapping-only, no write).
  const isExactDupAutoMap =
    item.classification === "exact_duplicate" && flags.includes("exact_duplicate_auto_map");
  const entityType = item.sourceEntityType === "payee" || item.sourceEntityType === "category" ? item.sourceEntityType : "transaction";
  // Opt-in update (source changed) and review-first delete (source removed) are
  // both explicitly selectable so the user drives them (RD-057 §4/§5).
  const isUpdate = item.plannedAction === "update";
  const isDelete = item.plannedAction === "delete";
  return {
    id: item.id,
    classification: item.classification,
    plannedAction: item.plannedAction,
    entityType,
    group: classificationGroup(item.classification),
    // Selectable: safe creates, marker/name-match repairs, auto-mappable dups,
    // opt-in updates, or review-first deletes.
    selectable:
      isSafeNew ||
      item.classification === "target_marker_match" ||
      item.classification === "target_name_match" ||
      isExactDupAutoMap ||
      isUpdate ||
      isDelete,
    isSafeNew,
    reviewRequired: isReviewRequired(item.classification) && !isExactDupAutoMap,
    applyState: item.applyState,
    sourceItemKey: item.sourceItemKey ?? "",
    isSplit: item.sourceEntityType === "split_line",
    flags,
    message: item.message,
    source: {
      date: str(source.date) ?? "",
      amount: numOrNull(source.amount),
      payeeName: str(source.payeeName),
      categoryName: str(source.categoryName),
      notes: str(source.notes),
    },
    target: {
      date: str(payload.date) ?? "",
      amount: numOrNull(payload.amount),
      payeeName: str(payload.payeeName),
      categoryName: null,
      notes: str(payload.notes),
    },
    fx: fxInfo(payload.fx),
  };
}

function fxInfo(value: unknown): PreviewRow["fx"] {
  const fx = record(value);
  const rate = str(fx.rate);
  const sourceCurrency = str(fx.sourceCurrency);
  const targetCurrency = str(fx.targetCurrency);
  if (!rate || !sourceCurrency || !targetCurrency) return null;
  return { sourceCurrency, targetCurrency, rate, effectiveDate: str(fx.effectiveDate) ?? "" };
}

/** Ids for "select all safe new" - excludes repair (marker-match) rows. */
export function selectableRowIds(rows: PreviewRow[]): string[] {
  return rows.filter((r) => r.isSafeNew).map((r) => r.id);
}

/** Row is a live review-queue member: review-required and still pending. */
export function isInReviewQueue(row: PreviewRow): boolean {
  return row.reviewRequired && (row.applyState == null || row.applyState === "pending");
}

/**
 * The RD-054 review queue: review-required items an automated run did not apply
 * and that still await a human decision. Applied/skipped items have been
 * resolved and drop out; a never-applied draft preview keeps its pending rows.
 */
export function reviewQueueRows(rows: PreviewRow[]): PreviewRow[] {
  return rows.filter(isInReviewQueue);
}

export function reviewQueueCount(rows: PreviewRow[]): number {
  return reviewQueueRows(rows).length;
}

const GROUP_LABELS: Record<PreviewGroup, string> = {
  new: "New",
  already_synced: "Already synced",
  duplicate: "Duplicate",
  source_changed: "Source changed",
  source_deleted: "Source deleted",
  marker_match: "Marker match",
  blocked: "Blocked",
  other: "Other",
};

export function groupLabel(group: PreviewGroup): string {
  return GROUP_LABELS[group];
}

/** Human status for a row, in the noun of its data type (e.g. "Name match"). */
export function statusLabel(row: PreviewRow): string {
  if (row.flags.includes("fx_rate_pending")) return "FX pending";
  if (row.flags.includes("fx_rate_changed")) return "Rate changed";
  if (row.classification === "target_name_match") return "Name match";
  return GROUP_LABELS[row.group];
}

/**
 * How a payee/category resolves on the target, for a clear column (RD-056
 * follow-up). We always show the source name and annotate its target fate:
 *  - `matched`   name matches a target entity by name.
 *  - `new`       no match, will be created on apply (payee auto-create only).
 *  - `unmatched` source *had* a name but it won't land on the target (no match
 *                and no auto-create) — the value is dropped.
 *  - `none`      the source field is genuinely empty.
 * The planner sets `missing_*_left_empty` only when the source had a name, so
 * "won't map" and "empty source" are always separable with no new plumbing.
 */
export function targetEntityDisplay(sourceName: string | null, flags: string[], kind: "payee" | "category"): { name: string; state: "matched" | "new" | "unmatched" | "none" } {
  if (flags.includes(`missing_${kind}_left_empty`)) return { name: sourceName ?? "", state: "unmatched" };
  if (!sourceName) return { name: "", state: "none" };
  if (kind === "payee" && flags.includes("missing_payee_created_on_apply")) return { name: sourceName, state: "new" };
  return { name: sourceName, state: "matched" };
}

export type PreviewTile = { key: string; label: string; value: number; tone?: "new" | "warn" | "bad"; filter: PreviewFilter };

/** The summary tiles for a run, worded for its data type. */
export function previewTiles(rows: PreviewRow[], kind: SyncKind): PreviewTile[] {
  const tiles = tileCounts(rows);
  const matched = rows.filter((r) => r.classification === "target_name_match").length;
  if (kind === "transaction") {
    return [
      { key: "new", label: "New - ready to sync", value: tiles.new, tone: "new", filter: "new" },
      { key: "needs_review", label: "Needs review", value: tiles.needsReview, tone: "warn", filter: "needs_review" },
      { key: "already", label: "Already synced", value: tiles.alreadySynced, filter: "already_synced" },
      { key: "blocked", label: "Blocked", value: tiles.blocked, tone: "bad", filter: "blocked" },
    ];
  }
  const noun = kind === "payee" ? "payees" : "categories";
  const base: PreviewTile[] = [
    { key: "new", label: `New ${noun}`, value: tiles.new, tone: "new", filter: "new" },
    { key: "name_match", label: "Match on target", value: matched, filter: "marker_match" },
    { key: "already", label: "Already synced", value: tiles.alreadySynced, filter: "already_synced" },
  ];
  // Only categories can be blocked (on ambiguous group placement); payees can't.
  if (kind === "category") base.push({ key: "blocked", label: "Needs a group", value: tiles.blocked, tone: "bad", filter: "blocked" });
  return base;
}

/** The table filter chips relevant to a data type. */
export function previewFilters(kind: SyncKind): { key: PreviewFilter; label: string }[] {
  if (kind === "transaction") return PREVIEW_FILTERS;
  const chips: { key: PreviewFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "new", label: "New" },
    { key: "marker_match", label: "Name match" },
    { key: "already_synced", label: "Already synced" },
  ];
  // Only categories can be blocked (ambiguous group); payees never are.
  if (kind === "category") chips.push({ key: "blocked", label: "Blocked" });
  return chips;
}

// --- Preview table filtering (detailed statuses) ---------------------------

export type PreviewFilter = "all" | "needs_review" | "review_queue" | PreviewGroup;

/** The three groups the "Needs review" tile/filter covers. */
const NEEDS_REVIEW_GROUPS: PreviewGroup[] = ["duplicate", "source_changed", "source_deleted", "marker_match"];

/** Chips shown above the table (detailed statuses; "needs_review" is tile-only). */
export const PREVIEW_FILTERS: { key: PreviewFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "duplicate", label: "Duplicates" },
  { key: "source_changed", label: "Source changed" },
  { key: "source_deleted", label: "Source deleted" },
  { key: "marker_match", label: "Marker match" },
  { key: "already_synced", label: "Already synced" },
  { key: "blocked", label: "Blocked" },
];

export function matchesPreviewFilter(row: PreviewRow, filter: PreviewFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs_review") return NEEDS_REVIEW_GROUPS.includes(row.group);
  if (filter === "review_queue") return isInReviewQueue(row);
  return row.group === filter;
}

export function filterCount(rows: PreviewRow[], filter: PreviewFilter): number {
  return rows.reduce((n, r) => n + (matchesPreviewFilter(r, filter) ? 1 : 0), 0);
}

/**
 * 1-based position of each split-line row among its parent transaction's
 * siblings, so the table can show "split 1/2" instead of two identical-looking
 * rows. Keyed by row id.
 */
export function splitPositions(rows: PreviewRow[]): Map<string, { index: number; total: number }> {
  const byTxn = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.isSplit) continue;
    const txnId = row.sourceItemKey.split(":")[1] ?? row.sourceItemKey;
    const ids = byTxn.get(txnId) ?? [];
    ids.push(row.id);
    byTxn.set(txnId, ids);
  }
  const positions = new Map<string, { index: number; total: number }>();
  for (const ids of byTxn.values()) {
    ids.forEach((id, i) => positions.set(id, { index: i + 1, total: ids.length }));
  }
  return positions;
}

/** Grouped counts for the four summary tiles. */
export type PreviewTileCounts = {
  new: number;
  needsReview: number;
  alreadySynced: number;
  blocked: number;
};

export function tileCounts(rows: PreviewRow[]): PreviewTileCounts {
  const counts: PreviewTileCounts = { new: 0, needsReview: 0, alreadySynced: 0, blocked: 0 };
  for (const row of rows) {
    if (row.group === "new") counts.new += 1;
    else if (row.group === "already_synced") counts.alreadySynced += 1;
    else if (row.group === "blocked") counts.blocked += 1;
    else if (
      row.group === "duplicate" ||
      row.group === "source_changed" ||
      row.group === "source_deleted" ||
      row.group === "marker_match"
    ) {
      counts.needsReview += 1;
    }
  }
  return counts;
}

const AMOUNT_FORMAT = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Minor units → grouped display string, e.g. -125000 → "-1,250.00". */
export function formatAmount(minor: number | null): string {
  if (minor == null) return "-";
  return AMOUNT_FORMAT.format(minor / 100);
}
