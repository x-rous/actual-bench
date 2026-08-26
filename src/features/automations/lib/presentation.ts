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
