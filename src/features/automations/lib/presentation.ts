import {
  ArrowLeftRight,
  DatabaseBackup,
  Landmark,
  ShieldCheck,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { compareValues, type SortDirection } from "@/components/ui/sortable-header";
import type { AutomationSortKey } from "../components/AutomationsTable";
import type { AutomationListItem } from "./automationsApi";
import type { AutomationExecutionMode, AutomationRun, AutomationRunStatus } from "@/lib/app-db/types";

/**
 * How an automation reads to a person (RD-079 / PR-043d).
 *
 * Kept out of the components so the wording — especially the execution-mode
 * honesty rule — is unit-testable rather than buried in JSX.
 */

export type ExecutionModeCopy = {
  label: string;
  detail: string;
};

/**
 * The honesty rule, in one place: server-side automations run with nothing
 * open; browser-owned ones do not, and the UI must say so rather than let a
 * user believe their laptop lid can stay shut.
 */
export function executionModeCopy(mode: AutomationExecutionMode): ExecutionModeCopy {
  if (mode === "server") {
    return {
      label: "Runs on the server",
      detail:
        "This runs on a schedule even with Actual Bench closed, using the credentials you enrolled. One server instance runs it — Bench does not coordinate across several.",
    };
  }
  return {
    label: "Runs in your browser",
    detail:
      "This only runs while Actual Bench is open in a browser tab. Close the tab and it stops until you come back — it is a convenience, not unattended automation.",
  };
}

export function runStatusLabel(status: AutomationRunStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "partial":
      return "Partly done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "no_changes":
      return "Nothing to do";
  }
}

export type StatusTone = "ok" | "warn" | "bad" | "muted";

export function runStatusTone(status: AutomationRunStatus): StatusTone {
  switch (status) {
    case "succeeded":
      return "ok";
    case "partial":
      return "warn";
    case "failed":
      return "bad";
    case "running":
    case "cancelled":
    case "no_changes":
      return "muted";
  }
}

/** "in 25 minutes" / "3 hours ago" — relative time, with the absolute value in
 * a title attribute at the call site so precision is never lost. */
export function relativeTime(iso: string | null, nowMs = Date.now()): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";

  const deltaSeconds = Math.round((ms - nowMs) / 1000);
  const absolute = Math.abs(deltaSeconds);

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.35],
    ["month", 12],
    ["year", Number.POSITIVE_INFINITY],
  ];

  let value = deltaSeconds;
  let remaining = absolute;
  for (const [unit, size] of units) {
    if (remaining < size) {
      return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(value), unit);
    }
    remaining /= size;
    value /= size;
  }
  return iso;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString();
}

export function runDuration(run: AutomationRun): string {
  if (!run.finishedAt) return "—";
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  if (Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

export function triggerLabel(run: AutomationRun): string {
  switch (run.trigger) {
    case "manual":
      return "Run now";
    case "retry":
      return `Retry (attempt ${run.attempt})`;
    case "schedule":
      return "Scheduled";
  }
}

/**
 * The one line at the top of the page: how many automations, whether anything
 * needs attention, and when the next one runs.
 *
 * "2 automations" alone answers a question nobody asked. What someone opening
 * this page wants to know is whether they can close it again.
 */
export function describeAutomationsSummary(
  automations: {
    status: "ok" | "warning" | "failing" | "paused" | "idle";
    enabled: boolean;
    autoPausedAt: string | null;
    nextRunAt: string | null;
  }[],
  nowMs = Date.now()
): string | undefined {
  if (automations.length === 0) return undefined;

  const count = `${automations.length} automation${automations.length === 1 ? "" : "s"}`;
  const failing = automations.filter((automation) => automation.status === "failing").length;
  const paused = automations.filter((automation) => automation.status === "paused").length;
  const warning = automations.filter((automation) => automation.status === "warning").length;

  const trouble = [
    failing > 0 ? `${failing} failing` : null,
    paused > 0 ? `${paused} paused` : null,
    warning > 0 ? `${warning} need attention` : null,
  ].filter((part): part is string => part !== null);

  const upcoming = automations
    .filter((automation) => automation.enabled && !automation.autoPausedAt && automation.nextRunAt)
    .map((automation) => Date.parse(automation.nextRunAt as string))
    .filter((ms) => !Number.isNaN(ms))
    .sort((a, b) => a - b)[0];

  const next = upcoming === undefined ? null : `next run ${relativeTime(new Date(upcoming).toISOString(), nowMs)}`;

  // Silence about trouble would read as reassurance, so it comes first.
  const parts = [count, ...(trouble.length > 0 ? [trouble.join(", ")] : ["all healthy"])];
  if (next) parts.push(next);
  return parts.join(" · ");
}

/**
 * The icon for a job type.
 *
 * Shared so the row you are reading and the menu you created it from show the
 * same mark - an icon that means one thing in a menu and another in a table is
 * worse than no icon.
 */
export function jobTypeIcon(type: string): LucideIcon {
  switch (type) {
    case "bank-sync":
      return Landmark;
    case "backup":
      return DatabaseBackup;
    case "backup-scrub":
      return ShieldCheck;
    case "budget-file-sync":
      return ArrowLeftRight;
    default:
      return Timer;
  }
}

/** Where a status sits when sorting: worst first, because that is why you sort. */
const STATUS_ORDER: Record<AutomationListItem["status"], number> = {
  failing: 0,
  paused: 1,
  warning: 2,
  idle: 3,
  ok: 4,
};

export function sortAutomations(
  automations: AutomationListItem[],
  sort: { key: AutomationSortKey; direction: SortDirection } | null
): AutomationListItem[] {
  if (!sort || !sort.direction) return automations;
  const { key, direction } = sort;

  const value = (automation: AutomationListItem): string | number | null => {
    switch (key) {
      case "status":
        return STATUS_ORDER[automation.status];
      case "name":
        return automation.name;
      case "type":
        return automation.typeLabel;
      case "schedule":
        return automation.scheduleLabel;
      case "lastRun":
        return automation.lastRunAt;
      case "nextRun":
        // A paused automation has no next run, whatever the stored value says.
        return automation.enabled && !automation.autoPausedAt ? automation.nextRunAt : null;
    }
  };

  return [...automations].sort((a, b) => compareValues(value(a), value(b), direction));
}
