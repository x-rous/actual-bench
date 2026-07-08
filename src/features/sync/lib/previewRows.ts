import type { SyncFlowRunItem, SyncItemClassification } from "@/lib/app-db/types";

/**
 * Read persisted run items into display rows for the preview table
 * (RD-053 / PR-019 Slice 5). Pure and UI-agnostic so it can be unit-tested.
 */

export type PreviewGroup =
  | "new"
  | "already_synced"
  | "duplicate"
  | "source_changed"
  | "marker_match"
  | "blocked"
  | "other";

export type PreviewRow = {
  id: string;
  classification: SyncItemClassification | null;
  group: PreviewGroup;
  /** Checkbox-enabled: safe-new create candidates or repairable marker matches. */
  selectable: boolean;
  /** Included in "select all safe new" (new create candidates only). */
  isSafeNew: boolean;
  sourceItemKey: string;
  isSplit: boolean;
  flags: string[];
  message: string | null;
  source: { date: string; amount: number | null; payeeName: string | null; categoryName: string | null; notes: string | null };
  target: { date: string; amount: number | null; payeeName: string | null; categoryName: string | null; notes: string | null };
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
    case "target_marker_match":
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
  return {
    id: item.id,
    classification: item.classification,
    group: classificationGroup(item.classification),
    // Marker-match rows are selectable for mapping repair (no target write).
    selectable: isSafeNew || item.classification === "target_marker_match",
    isSafeNew,
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
      categoryName: str(payload.categoryId),
      notes: str(payload.notes),
    },
  };
}

/** Ids for "select all safe new" — excludes repair (marker-match) rows. */
export function selectableRowIds(rows: PreviewRow[]): string[] {
  return rows.filter((r) => r.isSafeNew).map((r) => r.id);
}

const GROUP_LABELS: Record<PreviewGroup, string> = {
  new: "New",
  already_synced: "Already synced",
  duplicate: "Duplicate",
  source_changed: "Source changed",
  marker_match: "Marker match",
  blocked: "Blocked",
  other: "Other",
};

export function groupLabel(group: PreviewGroup): string {
  return GROUP_LABELS[group];
}

// --- Preview table filtering (detailed statuses) ---------------------------

export type PreviewFilter = "all" | "needs_review" | PreviewGroup;

/** The three groups the "Needs review" tile/filter covers. */
const NEEDS_REVIEW_GROUPS: PreviewGroup[] = ["duplicate", "source_changed", "marker_match"];

/** Chips shown above the table (detailed statuses; "needs_review" is tile-only). */
export const PREVIEW_FILTERS: { key: PreviewFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "duplicate", label: "Duplicates" },
  { key: "source_changed", label: "Source changed" },
  { key: "marker_match", label: "Marker match" },
  { key: "already_synced", label: "Already synced" },
  { key: "blocked", label: "Blocked" },
];

export function matchesPreviewFilter(row: PreviewRow, filter: PreviewFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs_review") return NEEDS_REVIEW_GROUPS.includes(row.group);
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
    else if (row.group === "duplicate" || row.group === "source_changed" || row.group === "marker_match") {
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
