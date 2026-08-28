"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLayout } from "@/components/layout/PageLayout";
import { cn } from "@/lib/utils";
import { fetchRunHistory } from "../lib/automationsApi";
import { AutomationsTabs } from "./AutomationsTabs";
import { RunHistoryFilterBar } from "./RunHistoryFilterBar";
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

export function RunHistoryView() {
  const params = useSearchParams();
  const automationFromUrl = params.get("automation") ?? "";

  const [search, setSearch] = useState("");
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

  // Searched client-side over what the row shows: the automation's name and the
  // line it reported. "What failed" is often remembered as a phrase from the
  // error, not as a status.
  const needle = search.trim().toLowerCase();
  const runs = (query.data?.runs ?? []).filter((run) =>
    needle
      ? [run.automationName, run.typeLabel, run.rollup?.message, run.error?.data.message]
          .filter((value): value is string => typeof value === "string")
          .some((value) => value.toLowerCase().includes(needle))
      : true
  );
  const total = query.data?.runs.length ?? 0;


  return (
    <PageLayout
      header={<AutomationsTabs />}
      scrollManaged
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <RunHistoryFilterBar
          search={search}
          onSearchChange={setSearch}
          statuses={statuses}
          onStatusesChange={setStatuses}
          automationId={automationId}
          onAutomationChange={setAutomationId}
          type={type}
          onTypeChange={setType}
          options={query.data}
          filteredCount={runs.length}
          totalCount={total}
          capped={total >= 200}
          actions={
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              aria-label="Refresh run history"
              title="Re-read the run history"
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
              Refresh
            </Button>
          }
        />

        {runs.length === 0 ? (
          <div className="mx-auto max-w-lg px-6 py-16 text-center">
            <h2 className="text-sm font-semibold">
              {statuses.length > 0 || automationId || type || search
                ? "Nothing matches those filters"
                : "Nothing has run yet"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {statuses.length > 0 || automationId || type || search
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
