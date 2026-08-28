"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { cn } from "@/lib/utils";
import { fetchRunHistory } from "../lib/automationsApi";
import { runStatusLabel } from "../lib/presentation";
import { RunRow } from "./RunRow";
import type { AutomationRunStatus } from "@/lib/app-db/types";

/**
 * Run history (RD-079).
 *
 * The automation drawer answers "is this one healthy" with its last few runs.
 * This page answers the question people actually arrive with, usually the
 * morning after: **what failed?** - which opening automations one at a time
 * does not answer, and a drawer has no room to.
 *
 * So the filters are the point, not decoration. Outcome first, because that is
 * the question; then the automation and the kind of job, for the times you are
 * chasing one thing in particular. Runs of a deleted automation stay listed:
 * the history of what happened is not undone by removing the thing that did it.
 */

const STATUS_FILTERS: AutomationRunStatus[] = [
  "failed",
  "partial",
  "succeeded",
  "no_changes",
  "running",
  "cancelled",
];

export function RunHistoryView() {
  const params = useSearchParams();
  const automationFromUrl = params.get("automation") ?? "";

  const [statuses, setStatuses] = useState<AutomationRunStatus[]>([]);
  const [automationId, setAutomationId] = useState(automationFromUrl);
  const [type, setType] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const query = useQuery({
    queryKey: ["automation-run-history", automationId, type, statuses.join(",")],
    queryFn: () =>
      fetchRunHistory({
        automationId: automationId || undefined,
        type: type || undefined,
        statuses,
        limit: 200,
      }),
    refetchInterval: 30_000,
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  function toggleStatus(status: AutomationRunStatus) {
    setStatuses((current) =>
      current.includes(status) ? current.filter((entry) => entry !== status) : [...current, status]
    );
  }

  const runs = query.data?.runs ?? [];
  const failing = runs.filter((run) => run.status === "failed" || run.status === "partial").length;

  return (
    <PageLayout
      title="Run history"
      count={query.data ? `${runs.length} ${runs.length === 1 ? "run" : "runs"}` : undefined}
      scrollManaged
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      actions={
        <>
          <Button variant="outline" size="sm" render={<Link href="/automations" />}>
            <ArrowLeft aria-hidden />
            Automations
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            aria-label="Refresh run history"
            title="Re-read the run history"
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
            Refresh
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
          {/* Outcome first: "what failed" is the question this page exists for,
              and it should take one click to ask. */}
          <span className="text-muted-foreground">Outcome</span>
          {STATUS_FILTERS.map((status) => {
            const active = statuses.includes(status);
            return (
              <button
                key={status}
                type="button"
                aria-pressed={active}
                onClick={() => toggleStatus(status)}
                className={cn(
                  "rounded-md border px-2 py-0.5 transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input text-muted-foreground hover:bg-accent"
                )}
              >
                {runStatusLabel(status)}
              </button>
            );
          })}

          <span className="ml-2 text-muted-foreground">Automation</span>
          <select
            className="h-6 rounded-md border border-input bg-background px-1.5 text-xs"
            value={automationId}
            onChange={(event) => setAutomationId(event.target.value)}
            aria-label="Filter by automation"
          >
            <option value="">Any</option>
            {query.data?.automations.map((automation) => (
              <option key={automation.id} value={automation.id}>
                {automation.name}
              </option>
            ))}
          </select>

          <span className="text-muted-foreground">Kind</span>
          <select
            className="h-6 rounded-md border border-input bg-background px-1.5 text-xs"
            value={type}
            onChange={(event) => setType(event.target.value)}
            aria-label="Filter by job type"
          >
            <option value="">Any</option>
            {query.data?.jobTypes.map((jobType) => (
              <option key={jobType.type} value={jobType.type}>
                {jobType.label}
              </option>
            ))}
          </select>

          {(statuses.length > 0 || automationId || type) && (
            <button
              type="button"
              className="text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setStatuses([]);
                setAutomationId("");
                setType("");
              }}
            >
              Clear
            </button>
          )}

          <span className="flex-1" />
          {failing > 0 && (
            <span className="text-destructive">
              {failing} of these {failing === 1 ? "run" : "runs"} did not finish cleanly
            </span>
          )}
        </div>

        {runs.length === 0 ? (
          <div className="mx-auto max-w-lg px-6 py-16 text-center">
            <h2 className="text-sm font-semibold">
              {statuses.length > 0 || automationId || type
                ? "Nothing matches those filters"
                : "Nothing has run yet"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {statuses.length > 0 || automationId || type
                ? "Clear a filter to widen the search."
                : "Runs appear here as automations fire - scheduled or on demand."}
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-auto px-4 py-3">
            {runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                context={{ automationName: run.automationName, typeLabel: run.typeLabel }}
              />
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
