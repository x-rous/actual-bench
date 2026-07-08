import type { SyncFlowRun } from "@/lib/app-db/types";

/**
 * Display helpers for run history (RD-053 / PR-019 Slice 5 UI). Pure and
 * testable. Structured for RD-054's automated runs — `trigger` already
 * distinguishes manual vs background.
 */

export type RunTone = "good" | "warn" | "bad" | "neutral";

export type RunRowView = {
  id: string;
  statusLabel: string;
  tone: RunTone;
  trigger: string;
  planned: number | null;
  created: number | null;
  relinked: number | null;
  failed: number | null;
  when: string;
};

function num(value: unknown): number | null {
  return typeof value === "number" ? value : null;
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
    default:
      return { label: status.replace(/_/g, " "), tone: "neutral" };
  }
}

function triggerLabel(trigger: string): string {
  return trigger === "background_future" ? "Automated" : "Manual";
}

export function toRunRow(run: SyncFlowRun): RunRowView {
  const status = statusView(run.status);
  const counts = run.counts?.data ?? {};
  const summary = run.summary?.data ?? {};
  const applied = run.status !== "draft_preview";
  return {
    id: run.id,
    statusLabel: status.label,
    tone: status.tone,
    trigger: triggerLabel(run.createdByTrigger),
    planned: num(summary.totalItems) ?? num(counts.new),
    created: applied ? num(counts.applied) ?? 0 : null,
    relinked: applied ? num(counts.repaired) ?? 0 : null,
    failed: applied ? num(counts.failed) ?? 0 : null,
    when: run.finishedAt ?? run.startedAt,
  };
}

/** Short "Applied · 2h ago" style label for the flow list. */
export function latestRunLabel(run: SyncFlowRun | undefined): string {
  if (!run) return "No runs yet";
  const { label } = statusView(run.status);
  return `${label} · ${relativeTime(run.finishedAt ?? run.startedAt)}`;
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
