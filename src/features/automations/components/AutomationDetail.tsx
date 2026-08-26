"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { listAutomationRuns, type AutomationListItem } from "../lib/automationsApi";
import {
  executionModeCopy,
  formatDateTime,
  runDuration,
  runStatusLabel,
  runStatusTone,
  triggerLabel,
} from "../lib/presentation";
import { AutomationResult } from "./resultRenderers";
import type { AutomationRun } from "@/lib/app-db/types";

/**
 * One automation's configuration and run history (RD-079 / PR-043d).
 *
 * The result of each run is rendered by the job type's own renderer, so this
 * component knows nothing about what a sync or a bank pull actually did.
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

function RunRow({ run }: { run: AutomationRun }) {
  const log = runLog(run);

  return (
    <details className="rounded-md border border-border">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <Badge variant={TONE_VARIANT[runStatusTone(run.status)]}>{runStatusLabel(run.status)}</Badge>
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

export function AutomationDetail({
  automation,
  onClose,
}: {
  automation: AutomationListItem;
  onClose: () => void;
}) {
  const runsQuery = useQuery({
    queryKey: ["automation-runs", automation.id],
    queryFn: () => listAutomationRuns(automation.id),
  });

  const mode = executionModeCopy(automation.executionMode);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{automation.name}</SheetTitle>
          <SheetDescription>{automation.scheduleLabel}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-auto px-4 pb-6">
          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Where it runs</h3>
            <p className="mt-1 text-sm">{mode.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{mode.detail}</p>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Status</h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Last run</dt>
                <dd className="mt-0.5">{formatDateTime(automation.lastRunAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last success</dt>
                <dd className="mt-0.5">{formatDateTime(automation.lastSuccessAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Next run</dt>
                <dd className="mt-0.5">
                  {automation.enabled && !automation.autoPausedAt
                    ? formatDateTime(automation.nextRunAt)
                    : "Not scheduled"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Consecutive failures</dt>
                <dd className="mt-0.5">{automation.consecutiveFailures}</dd>
              </div>
            </dl>

            {automation.autoPauseReason && (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                {automation.autoPauseReason}
              </p>
            )}
          </section>

          <section className="min-h-0">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Run history</h3>

            {runsQuery.isLoading && <p className="mt-2 text-xs text-muted-foreground">Loading runs…</p>}
            {runsQuery.isError && (
              <p className="mt-2 text-xs text-destructive">{(runsQuery.error as Error).message}</p>
            )}
            {runsQuery.data?.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">This automation has not run yet.</p>
            )}

            <div className="mt-2 space-y-2">
              {runsQuery.data?.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
