"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { listAutomationRuns, type AutomationListItem } from "../lib/automationsApi";
import { executionModeCopy, formatDateTime } from "../lib/presentation";
import { RunRow } from "./RunRow";

/**
 * One automation's configuration and run history (RD-079 / PR-043d).
 *
 * The result of each run is rendered by the job type's own renderer, so this
 * component knows nothing about what a sync or a bank pull actually did.
 */

export function AutomationDetail({
  automation,
  onClose,
}: {
  automation: AutomationListItem;
  onClose: () => void;
}) {
  // The newest ten: a drawer is for "is this healthy", and the answer is in the
  // last few runs. Anything more is a question for the history page, which can
  // filter and has the room to show the answer.
  const runsQuery = useQuery({
    queryKey: ["automation-runs", automation.id],
    queryFn: () => listAutomationRuns(automation.id, 10),
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
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                Recent runs
              </h3>
              <Link
                href={`/automations/runs?automation=${automation.id}`}
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                All runs
              </Link>
            </div>

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
