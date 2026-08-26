"use client";

import { AlertTriangle, CircleDot, Loader2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { executionModeCopy, formatDateTime, relativeTime } from "../lib/presentation";
import type { AutomationListItem } from "../lib/automationsApi";

/**
 * The Automations list (RD-079).
 *
 * A table, like the rest of Actual Bench's list pages, because this is an
 * operational screen: the question is "is everything fine, what ran, what is
 * next", and that is a scanning task. One line per automation answers it; the
 * side sheet holds the detail.
 *
 * Two rules shape the layout:
 *
 *   * **Space in proportion to trouble.** A healthy automation gets one line. A
 *     failing or paused one gets a second, carrying the reason — the only text
 *     here worth interrupting a scan for.
 *   * **Say the type.** A name like "Test 2" means nothing once bank sync sits
 *     beside budget file sync, so the job type is a column rather than
 *     something you infer from the result wording.
 *
 * The execution-mode explanation is stated once for the page instead of being
 * repeated per row: the honesty rule is about the user knowing, not about the
 * sentence appearing N times.
 */

const STATUS_STYLE: Record<
  AutomationListItem["status"],
  { dot: string; label: string; row?: string }
> = {
  ok: { dot: "text-green-600 dark:text-green-500", label: "Healthy" },
  warning: {
    dot: "text-amber-600 dark:text-amber-500",
    label: "Needs attention",
    row: "bg-amber-50/40 dark:bg-amber-950/10",
  },
  failing: {
    dot: "text-destructive",
    label: "Failing",
    row: "bg-destructive/5",
  },
  paused: {
    dot: "text-amber-600 dark:text-amber-500",
    label: "Paused",
    row: "bg-amber-50/40 dark:bg-amber-950/10",
  },
  idle: { dot: "text-muted-foreground", label: "Idle" },
};

type AutomationsTableProps = {
  automations: AutomationListItem[];
  runningId: string | null;
  onOpen: (automationId: string) => void;
  onRunNow: (automationId: string) => void;
  onToggleEnabled: (automation: AutomationListItem) => void;
  onResume: (automationId: string) => void;
};

export function AutomationsTable({
  automations,
  runningId,
  onOpen,
  onRunNow,
  onToggleEnabled,
  onResume,
}: AutomationsTableProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] uppercase text-muted-foreground">
          <tr>
            <th className="w-8 px-3 py-2">
              <span className="sr-only">Status</span>
            </th>
            <th className="px-3 py-2">Automation</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Schedule</th>
            <th className="px-3 py-2">Last run</th>
            <th className="px-3 py-2">Next run</th>
            <th className="w-px px-3 py-2 text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {automations.map((automation) => {
            const style = STATUS_STYLE[automation.status];
            const mode = executionModeCopy(automation.executionMode);
            const paused = Boolean(automation.autoPausedAt);
            const busy = automation.running || runningId === automation.id;
            // Only a row in trouble earns a second line; a healthy one says all
            // it needs to on the first. Keyed off the pause reason as well as
            // the derived status, so a reason can never be present and unshown.
            const needsExplanation =
              automation.status === "failing" ||
              automation.status === "paused" ||
              Boolean(automation.autoPauseReason);

            return (
              <tr
                key={automation.id}
                className={cn("border-t border-border/60 align-top", style.row)}
                data-testid="automation-row"
              >
                <td className="px-3 py-2">
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Running" />
                  ) : (
                    <CircleDot className={cn("size-3.5", style.dot)} aria-label={style.label} />
                  )}
                </td>

                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onOpen(automation.id)}
                  >
                    {automation.name}
                  </button>
                  {!automation.enabled && !paused && (
                    <span className="ml-2 text-muted-foreground">Off</span>
                  )}
                  {needsExplanation && (
                    <p className="mt-1 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <AlertTriangle className="mt-px size-3 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden />
                      <span>{automation.autoPauseReason ?? automation.statusSummary}</span>
                    </p>
                  )}
                </td>

                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {automation.typeLabel}
                </td>

                <td className="px-3 py-2 whitespace-nowrap">
                  {automation.scheduleLabel}
                  <span className="text-muted-foreground"> · </span>
                  {/* The mode is the one thing people get wrong about an
                      automation, so it stays on the row — with the full
                      explanation a hover away rather than repeated in prose. */}
                  <span className="cursor-help underline decoration-dotted" title={mode.detail}>
                    {automation.executionMode === "server" ? "Server" : "Browser only"}
                  </span>
                </td>

                <td className="px-3 py-2">
                  {automation.lastRunAt ? (
                    <span title={formatDateTime(automation.lastRunAt)}>
                      {relativeTime(automation.lastRunAt)}
                      {automation.lastRun?.rollup?.message && (
                        <span className="text-muted-foreground">
                          {" · "}
                          {automation.lastRun.rollup.message}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Never</span>
                  )}
                </td>

                <td className="px-3 py-2 whitespace-nowrap" title={formatDateTime(automation.nextRunAt)}>
                  {automation.enabled && !paused ? (
                    relativeTime(automation.nextRunAt)
                  ) : (
                    <span className="text-muted-foreground">Not scheduled</span>
                  )}
                </td>

                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onRunNow(automation.id)}
                      aria-label={`Run ${automation.name} now`}
                    >
                      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
                      Run now
                    </Button>

                    {paused ? (
                      <Button variant="outline" size="sm" onClick={() => onResume(automation.id)}>
                        Resume
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onToggleEnabled(automation)}
                        aria-label={
                          automation.enabled
                            ? `Pause ${automation.name}`
                            : `Enable ${automation.name}`
                        }
                      >
                        {automation.enabled ? <Pause aria-hidden /> : <Play aria-hidden />}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
