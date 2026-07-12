import type { SyncFlowRun } from "@/lib/app-db/types";

/**
 * Display helpers for run history (RD-053 / PR-019 Slice 5 UI). Pure and
 * testable. Structured for RD-054's automated runs - `trigger` already
 * distinguishes manual vs background.
 */

export type RunTone = "good" | "warn" | "bad" | "neutral";

export type RunRowView = {
  id: string;
  statusLabel: string;
  tone: RunTone;
  trigger: string;
  /** True for an automated safe-only run (interval / "Run safe sync now"). */
  isAuto: boolean;
  /** One-line preview-aligned breakdown, e.g. "31 scanned · 3 new · 26 synced". */
  result: string;
  planned: number | null;
  created: number | null;
  relinked: number | null;
  failed: number | null;
  /** Review-required items this run did not apply (the review queue). */
  queued: number | null;
  when: string;
};

function num(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function n0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** True for an automated safe-only run. */
export function isAutoRun(run: SyncFlowRun): boolean {
  return run.createdByTrigger === "interval_safe_only";
}

/**
 * Count of review-required items a run left for the human (the review queue),
 * derived from the persisted preview summary: duplicates + source-changed +
 * blocked. Zero on runs without a stored summary.
 */
export function runQueuedCount(run: SyncFlowRun): number {
  const s = run.summary?.data ?? {};
  return n0(s.duplicatesSkipped) + n0(s.sourceChangedWarnings) + n0(s.blocked);
}

/** Auto-applied count for an applied run: creates plus mapping repairs. */
export function runAutoAppliedCount(run: SyncFlowRun): number {
  const c = run.counts?.data ?? {};
  return n0(c.applied) + n0(c.repaired);
}

/**
 * A run needs the user's attention when it failed/partially applied, or left
 * items in the review queue. Used for the flow-list notification badge.
 */
export function runNeedsAttention(run: SyncFlowRun): boolean {
  return run.status === "failed" || run.status === "partial" || runQueuedCount(run) > 0;
}

function statusView(status: string): { label: string; tone: RunTone } {
  switch (status) {
    case "draft_preview":
      return { label: "Preview only", tone: "neutral" };
    case "applying":
      return { label: "Syncing", tone: "warn" };
    case "applied":
      return { label: "Synced", tone: "good" };
    case "partial":
      return { label: "Partial", tone: "warn" };
    case "failed":
      return { label: "Failed", tone: "bad" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "no_changes":
      return { label: "No changes", tone: "neutral" };
    default:
      return { label: status.replace(/_/g, " "), tone: "neutral" };
  }
}

function triggerLabel(trigger: string): string {
  switch (trigger) {
    case "interval_safe_only":
      return "Auto-sync";
    case "scheduled_unattended":
      return "Scheduled";
    case "manual_apply":
    case "manual_preview":
    default:
      return "Manual";
  }
}

/**
 * One-line, preview-aligned breakdown of what a run did, so history is readable
 * without opening each run. A failed run shows its reason instead of counts.
 * Always shows scanned/new/synced; only appends the rest when non-zero.
 */
export function runResultSummary(run: SyncFlowRun): string {
  const s = (run.summary?.data ?? {}) as Record<string, unknown>;
  const c = (run.counts?.data ?? {}) as Record<string, unknown>;

  if (run.status === "failed") return runErrorMessage(run) ?? "Failed";

  const scanned = n0(s.sourceItemsScanned) || n0(s.sourceTransactionsScanned) || n0(s.plannedItems);
  // For an applied run "new" is what was actually created; before apply it's the
  // planned create candidates (0 for a "no changes" run).
  const created = run.status === "applied" || run.status === "partial" ? n0(c.applied) : n0(s.createCandidates);
  const already = n0(s.alreadySynced) + n0(s.targetMarkerMatches);
  const parts = [`${scanned} scanned`, `${created} new`, `${already} synced`];

  // dup + changed + blocked ARE the review queue (see runQueuedCount), so list
  // them individually rather than adding a redundant "to review" total.
  const dup = n0(s.duplicatesSkipped);
  const changed = n0(s.sourceChangedWarnings);
  const blocked = n0(s.blocked);
  const failed = n0(c.failed);
  if (dup > 0) parts.push(`${dup} dup`);
  if (changed > 0) parts.push(`${changed} changed`);
  if (blocked > 0) parts.push(`${blocked} blocked`);
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(" · ");
}

export function toRunRow(run: SyncFlowRun): RunRowView {
  const status = statusView(run.status);
  const counts = run.counts?.data ?? {};
  const summary = run.summary?.data ?? {};
  const applied = run.status !== "draft_preview";
  const queued = runQueuedCount(run);
  return {
    id: run.id,
    statusLabel: status.label,
    tone: status.tone,
    trigger: triggerLabel(run.createdByTrigger),
    isAuto: isAutoRun(run),
    result: runResultSummary(run),
    planned: num(summary.totalItems) ?? num(counts.new),
    created: applied ? num(counts.applied) ?? 0 : null,
    relinked: applied ? num(counts.repaired) ?? 0 : null,
    failed: applied ? num(counts.failed) ?? 0 : null,
    queued: queued > 0 ? queued : null,
    when: run.finishedAt ?? run.startedAt,
  };
}

/** Short "Applied · 2h ago" style label for the flow list. */
export function latestRunLabel(run: SyncFlowRun | undefined): string {
  if (!run) return "No runs yet";
  const { label } = statusView(run.status);
  return `${label} · ${relativeTime(run.finishedAt ?? run.startedAt)}`;
}

/**
 * Human-readable message for a run-level failure (RD-058 follow-up). The apply
 * layer stores `{ code, message }` in the run's `error` envelope; a `failed`
 * run with no per-item errors (e.g. the target budget couldn't be opened) has
 * its only explanation here, so surface it in the run detail.
 */
export function runErrorMessage(run: SyncFlowRun): string | null {
  const data = run.error?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : null;
    const code = typeof record.code === "string" ? record.code : null;
    if (message) return code ? `${message} (${code})` : message;
    if (code) return code;
  }
  return typeof data === "string" ? data : null;
}

/** Absolute local date + time for a run, for the history table and run detail. */
export function formatRunTimestamp(iso: string | null): string {
  if (!iso) return "In progress";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
