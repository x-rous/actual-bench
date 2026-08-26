"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Info, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import Link from "next/link";
import {
  listAutomations,
  listReviewQueue,
  patchAutomation,
  runAutomationNow,
  type AutomationListItem,
} from "../lib/automationsApi";
import {
  executionModeCopy,
  formatDateTime,
  relativeTime,
  runStatusLabel,
  runStatusTone,
} from "../lib/presentation";
import { AutomationDetail } from "./AutomationDetail";

/**
 * The Automations workspace (RD-079 / PR-043d).
 *
 * Answers, without opening anything: what runs, when it last ran, what runs
 * next, what is broken — and whether a given automation actually runs when the
 * browser is closed. That last one is a per-row statement rather than a page
 * footnote, because it is the question a user is most likely to get wrong.
 *
 * Deliberately named "Automations" for Bench's own scheduled jobs. Actual
 * Budget's experimental Budget Automations (RD-047) are a different thing that
 * Bench does not drive; nothing here should read as that feature.
 */

const TONE_VARIANT = {
  ok: "status-active",
  warn: "status-warning",
  bad: "destructive",
  muted: "secondary",
} as const;

function LastRunBadge({ automation }: { automation: AutomationListItem }) {
  if (automation.running) {
    return (
      <Badge variant="secondary">
        <Loader2 className="animate-spin" aria-hidden />
        Running
      </Badge>
    );
  }
  if (!automation.lastRun) return <span className="text-muted-foreground">Never run</span>;

  const status = automation.lastRun.status;
  return (
    <span className="flex items-center gap-2">
      <Badge variant={TONE_VARIANT[runStatusTone(status)]}>{runStatusLabel(status)}</Badge>
      <span className="text-muted-foreground" title={formatDateTime(automation.lastRunAt)}>
        {relativeTime(automation.lastRunAt)}
      </span>
    </span>
  );
}

export function AutomationsView() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const automationsQuery = useQuery({
    queryKey: ["automations"],
    queryFn: listAutomations,
    // Runs finish while the page is open; a paused poll would show stale state.
    refetchInterval: 15_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["automations"] });
    void queryClient.invalidateQueries({ queryKey: ["automation-runs"] });
  };

  const runNow = useMutation({
    mutationFn: runAutomationNow,
    onSuccess: (outcome) => {
      // Say what happened. A failed run comes back as a 200 with a failed
      // outcome, and calling that "Run finished" hides exactly the thing the
      // user pressed the button to find out.
      if (outcome.status === "failed") {
        toast.error(outcome.message ? `Run failed: ${outcome.message}` : "Run failed");
      } else if (outcome.status === "skipped") {
        // Nothing ran — the automation was locked, paused or unresolvable.
        toast.warning(outcome.message ?? "The run did not start");
      } else if (outcome.status === "partial") {
        toast.warning(outcome.message ?? "Run finished with some items unfinished");
      } else if (outcome.status === "no_changes") {
        toast.success(outcome.message ?? "Nothing to do");
      } else {
        toast.success(outcome.message ?? "Run finished");
      }
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => patchAutomation(id, { enabled }),
    onSuccess: () => invalidate(),
    onError: (error: Error) => toast.error(error.message),
  });

  const resume = useMutation({
    mutationFn: (id: string) => patchAutomation(id, { resume: true }),
    onSuccess: () => {
      toast.success("Automation resumed");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reviewQueueQuery = useQuery({
    queryKey: ["automation-review-queue"],
    queryFn: listReviewQueue,
    refetchInterval: 30_000,
  });

  const automations = automationsQuery.data?.automations ?? [];
  const reviewQueue = reviewQueueQuery.data ?? [];
  const selected = automations.find((automation) => automation.id === selectedId) ?? null;

  return (
    <PageLayout
      title="Automations"
      count={automations.length > 0 ? `${automations.length} automation${automations.length === 1 ? "" : "s"}` : undefined}
      isLoading={automationsQuery.isLoading}
      isError={automationsQuery.isError}
      error={automationsQuery.error}
      onRetry={() => void automationsQuery.refetch()}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void automationsQuery.refetch()}
          aria-label="Refresh automations"
        >
          <RefreshCw aria-hidden />
          Refresh
        </Button>
      }
      emptyState={
        automations.length === 0 ? (
          <div className="mx-auto max-w-lg px-6 py-16 text-center">
            <h2 className="text-sm font-semibold">No automations yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Scheduled work shows up here. A Budget File Sync flow set to run unattended becomes an
              automation automatically, so you can see when it last ran and what it did.
            </p>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 p-4">
        {reviewQueue.length > 0 && (
          <section
            className="rounded-md border border-amber-400/30 bg-amber-50 p-4 dark:bg-amber-950/20"
            aria-labelledby="review-queue-heading"
          >
            <h2 id="review-queue-heading" className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Waiting for you to decide
            </h2>
            <ul className="mt-2 space-y-1.5 text-xs">
              {reviewQueue.map((entry) => (
                <li key={entry.automationId} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{entry.automationName}</span>
                  <span className="text-muted-foreground">{entry.summary}</span>
                  <Link href={entry.href} className="text-primary underline-offset-4 hover:underline">
                    Review in {entry.typeLabel}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {automations.map((automation) => {
          const mode = executionModeCopy(automation.executionMode);
          const paused = Boolean(automation.autoPausedAt);
          const isStarting = runNow.isPending && runNow.variables === automation.id;

          return (
            <div
              key={automation.id}
              className="rounded-md border border-border bg-card p-4 text-sm"
              data-testid="automation-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setSelectedId(automation.id)}
                    >
                      {automation.name}
                    </button>
                    {paused && <Badge variant="status-warning">Auto-paused</Badge>}
                    {!automation.enabled && !paused && <Badge variant="status-inactive">Off</Badge>}
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    {automation.scheduleLabel} · {mode.label}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    // Scoped to *this* automation: `isPending` alone claimed
                    // every row was running whenever any one of them was.
                    disabled={automation.running || isStarting}
                    onClick={() => runNow.mutate(automation.id)}
                  >
                    {automation.running || isStarting ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Play aria-hidden />
                    )}
                    Run now
                  </Button>

                  {paused ? (
                    <Button variant="outline" size="sm" onClick={() => resume.mutate(automation.id)}>
                      Resume
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEnabled.mutate({ id: automation.id, enabled: !automation.enabled })}
                      aria-label={automation.enabled ? "Pause automation" : "Enable automation"}
                    >
                      {automation.enabled ? <Pause aria-hidden /> : <Play aria-hidden />}
                      {automation.enabled ? "Pause" : "Enable"}
                    </Button>
                  )}
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Last run</dt>
                  <dd className="mt-0.5">
                    <LastRunBadge automation={automation} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Next run</dt>
                  <dd className="mt-0.5" title={formatDateTime(automation.nextRunAt)}>
                    {automation.enabled && !paused ? relativeTime(automation.nextRunAt) : "Not scheduled"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Result</dt>
                  <dd className="mt-0.5 truncate" title={automation.lastRun?.rollup?.message ?? undefined}>
                    {automation.lastRun?.rollup?.message ?? "—"}
                  </dd>
                </div>
              </dl>

              {paused && automation.autoPauseReason && (
                <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                  <span>{automation.autoPauseReason}</span>
                </p>
              )}

              <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>{mode.detail}</span>
              </p>
            </div>
          );
        })}
      </div>

      {selected && <AutomationDetail automation={selected} onClose={() => setSelectedId(null)} />}
    </PageLayout>
  );
}
