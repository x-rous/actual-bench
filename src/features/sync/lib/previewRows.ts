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
  source: { date: string; amount: number | null; payeeName: string | null; categoryName: string | null };
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

/** Minor units → display string, e.g. -1250 → "-12.50". */
export function formatAmount(minor: number | null): string {
  if (minor == null) return "—";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
