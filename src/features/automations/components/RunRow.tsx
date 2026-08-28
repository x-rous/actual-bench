"use client";

import { Badge } from "@/components/ui/badge";
import { AutomationResult } from "./resultRenderers";
import {
  formatDateTime,
  runDuration,
  runStatusLabel,
  runStatusTone,
  triggerLabel,
} from "../lib/presentation";
import type { AutomationRun } from "@/lib/app-db/types";

/**
 * One run, expandable (RD-079).
 *
 * Shared by the automation drawer and the run history page so the two cannot
 * drift: a run means the same thing, and shows the same evidence, wherever it
 * is read. The result itself is rendered by the job type's own renderer, so
 * this component knows nothing about what a sync or a backup actually did.
 */

const TONE_VARIANT = {
  ok: "status-active",
  warn: "status-warning",
  bad: "destructive",
  muted: "secondary",
} as const;

type LogEntry = { level: string; message: string; at: string };

/**
 * The log lives inside a job type's own result payload, which the engine stores
 * without inspecting — so nothing guarantees an entry's `message` is a string.
 * Checking only that the key exists let an object reach React as a child and
 * take down the whole run-history section.
 */
function runLog(run: AutomationRun): LogEntry[] {
  const log = run.result?.data.log;
  if (!Array.isArray(log)) return [];

  return log.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.message !== "string") return [];
    return [
      {
        level: typeof record.level === "string" ? record.level : "info",
        message: record.message,
        at: typeof record.at === "string" ? record.at : "",
      },
    ];
  });
}

export function RunRow({
  run,
  context,
}: {
  run: AutomationRun;
  /** Which automation this was, when the list spans more than one. */
  context?: { automationName: string; typeLabel: string };
}) {
  const log = runLog(run);

  return (
    <details className="rounded-md border border-border">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <Badge variant={TONE_VARIANT[runStatusTone(run.status)]}>{runStatusLabel(run.status)}</Badge>
        {context && (
          <>
            <span className="font-medium">{context.automationName}</span>
            <span className="text-muted-foreground">{context.typeLabel}</span>
          </>
        )}
        <span className="text-muted-foreground">{formatDateTime(run.startedAt)}</span>
        <span className="text-muted-foreground">· {triggerLabel(run)}</span>
        <span className="text-muted-foreground">· {runDuration(run)}</span>
        {run.rollup?.message && <span className="min-w-0 flex-1 truncate">{run.rollup.message}</span>}
      </summary>

      <div className="space-y-3 border-t border-border px-3 py-3">
        <AutomationResult run={run} />

        {run.error?.data.message !== undefined && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {String(run.error.data.message)}
          </p>
        )}

        {log.length > 0 && (
          <div>
            <h4 className="text-xs font-medium">Log</h4>
            <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {log.map((entry, index) => (
                <li key={index} className={entry.level === "error" ? "text-destructive" : undefined}>
                  {entry.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

