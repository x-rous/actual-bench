"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, DatabaseBackup, Landmark, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageLayout } from "@/components/layout/PageLayout";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  listAutomations,
  listReviewQueue,
  patchAutomation,
  runAutomationNow,
} from "../lib/automationsApi";

import { AutomationDetail } from "./AutomationDetail";
import { AutomationsTable } from "./AutomationsTable";
import { NewBankSyncDialog } from "./NewBankSyncDialog";
import { describeAutomationsSummary } from "../lib/presentation";

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

export function AutomationsView() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  /**
   * Spins for a refresh someone asked for, and only that.
   *
   * Keying the animation off `isFetching` would spin every 15 seconds as the
   * background poll runs, which reads as activity when nothing is happening —
   * and would leave a user unable to tell whether their click did anything.
   */
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([automationsQuery.refetch(), reviewQueueQuery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }

  const automations = automationsQuery.data?.automations ?? [];
  const reviewQueue = reviewQueueQuery.data ?? [];
  const selected = automations.find((automation) => automation.id === selectedId) ?? null;

  return (
    <PageLayout
      title="Automations"
      count={describeAutomationsSummary(automations)}
      scrollManaged
      isLoading={automationsQuery.isLoading}
      isError={automationsQuery.isError}
      error={automationsQuery.error}
      onRetry={() => void automationsQuery.refetch()}
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            aria-label="Refresh automations"
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
            Refresh
          </Button>
          {/* One entry point for everything schedulable, rather than a button
              for whichever type happened to ship first. It also answers the
              question a single button cannot: *what else can Bench run for
              me* — and where each of those is set up. */}
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(buttonVariants({ size: "sm" }))}>
              <Plus aria-hidden />
              New automation
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onSelect={() => setCreating(true)}>
                <Landmark aria-hidden />
                <span className="flex flex-col">
                  <span className="font-medium">Bank sync</span>
                  <span className="text-xs text-muted-foreground">
                    Pull new transactions from your connected banks.
                  </span>
                </span>
              </DropdownMenuItem>
              {/* Real links, not router pushes: they middle-click, they show a
                  destination in the status bar, and they need no router in a
                  test that only renders this view. */}
              <DropdownMenuItem render={<Link href="/backups" />}>
                <DatabaseBackup aria-hidden />
                <span className="flex flex-col">
                  <span className="font-medium">Backup</span>
                  <span className="text-xs text-muted-foreground">
                    Verified copies of your budget, set up in Backups.
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/sync" />}>
                <ArrowLeftRight aria-hidden />
                <span className="flex flex-col">
                  <span className="font-medium">Budget file sync</span>
                  <span className="text-xs text-muted-foreground">
                    Copy data between budget files, set up in Budget File Sync.
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      emptyState={
        automations.length === 0 ? (
          <div className="mx-auto max-w-xl px-6 py-14">
            <h2 className="text-sm font-semibold">Nothing is scheduled yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Three things can run on a schedule with Actual Bench closed:
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => setCreating(true)}
                >
                  Bank sync
                </button>
                <span className="text-muted-foreground">
                  {" "}
                  — ask Actual to pull new transactions from the banks you connected to it.
                </span>
              </li>
              <li>
                <Link href="/backups" className="font-medium text-primary underline-offset-4 hover:underline">
                  Backups
                </Link>
                <span className="text-muted-foreground">
                  {" "}
                  — verified copies of your budget, kept to rules that never delete the last good one.
                </span>
              </li>
              <li>
                <Link href="/sync" className="font-medium text-primary underline-offset-4 hover:underline">
                  Budget File Sync
                </Link>
                <span className="text-muted-foreground">
                  {" "}
                  — a flow appears here once its review policy is{" "}
                  <strong className="font-medium">Auto-sync on a server schedule (unattended)</strong>.
                  A flow set to manual review stays out of here on purpose.
                </span>
              </li>
            </ul>
          </div>
        ) : undefined
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Stated once for the page instead of on every row: the rule is that
            the user knows where automations run, not that the sentence repeats. */}
        <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          Automations marked <strong className="font-medium">Server</strong> run on a schedule even
          with Actual Bench closed. One server instance runs them — Bench does not coordinate across
          several.
        </p>

        {reviewQueue.length > 0 && (
          <section
            className="border-b border-amber-400/30 bg-amber-50 px-4 py-3 dark:bg-amber-950/20"
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

        <AutomationsTable
          automations={automations}
          runningId={runNow.isPending ? (runNow.variables ?? null) : null}
          onOpen={setSelectedId}
          onRunNow={(id) => runNow.mutate(id)}
          onToggleEnabled={(automation) =>
            setEnabled.mutate({ id: automation.id, enabled: !automation.enabled })
          }
          onResume={(id) => resume.mutate(id)}
        />
      </div>

      <NewBankSyncDialog open={creating} onOpenChange={setCreating} onCreated={invalidate} />

      {selected && <AutomationDetail automation={selected} onClose={() => setSelectedId(null)} />}
    </PageLayout>
  );
}
