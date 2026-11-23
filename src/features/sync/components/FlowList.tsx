"use client";

import { useMemo, useState } from "react";
import { Fragment } from "react";
import { BellRing, Coins, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { flowGroupName, groupFlows } from "../lib/flowGroups";
import { cn } from "@/lib/utils";
import { useNowMs } from "@/hooks/useNowMs";
import { connectionFingerprint, connectionMatchesBudget } from "@/lib/sync/connectionRef";
import { decodeFlowPlanConfig } from "@/lib/sync/flowConfig";
import { latestRunLabel, runNeedsAttention, runQueuedCount } from "../lib/runsView";
import {
  computeUnattendedStatus,
  isEnrolled,
  NO_ENROLMENTS,
  nextRunPhrase,
  type EnginePause,
  type EnrolledIndex,
} from "../lib/unattendedStatus";
import type { ConnectionInstance } from "@/store/connection";
import type { SyncFlow, SyncFlowRun } from "@/lib/app-db/types";
import { SearchInput } from "@/components/ui/search-input";

type FlowListProps = {
  flows: SyncFlow[];
  selectedFlowId: string | null;
  latestRuns: Map<string, SyncFlowRun>;
  connections: ConnectionInstance[];
  /** Null while the vault state is unknown. */
  vaultReady?: boolean | null;
  /** What is enrolled, by connection and by budget (PR-071c). */
  enrolled?: EnrolledIndex;
  /** Engine health-pause per flow id, from `useFlowAutomations`. */
  enginePauses?: Map<string, EnginePause | null>;
  onSelect: (flowId: string) => void;
  onCreate: () => void;
  /** Open the guided setup for a foreign-currency budget. */
  onAddCurrency?: () => void;
  /** How many flows need attention, and how to open that list. */
  attentionCount?: number;
  onShowAttention?: () => void;
  /** Open the run dialog for a named group. */
  onRunGroup?: (name: string) => void;
};

function connectionAvailable(
  fingerprint: string,
  budgetSyncId: string,
  connections: ConnectionInstance[]
): boolean {
  const exactMatch = fingerprint
    ? connections.some((connection) => connectionFingerprint(connection) === fingerprint)
    : false;
  return exactMatch || connections.some((connection) => connectionMatchesBudget(connection, budgetSyncId));
}

export function FlowList({
  flows,
  selectedFlowId,
  latestRuns,
  connections,
  vaultReady = null,
  enrolled = NO_ENROLMENTS,
  enginePauses = new Map<string, EnginePause | null>(),
  onSelect,
  onCreate,
  onAddCurrency,
  attentionCount = 0,
  onShowAttention,
  onRunGroup,
}: FlowListProps) {
  const [search, setSearch] = useState("");
  const nowMs = useNowMs();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return flows;
    return flows.filter((flow) => {
      const config = decodeFlowPlanConfig(flow);
      return (
        flow.name.toLowerCase().includes(q) ||
        config.sourceBudgetName.toLowerCase().includes(q) ||
        config.targetBudgetName.toLowerCase().includes(q)
      );
    });
  }, [flows, search]);

  const ordered = groupFlows(filtered).flatMap((group) => group.flows);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-28 flex-col justify-center gap-2 border-b border-border px-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Sync flows
            {onShowAttention && (
              <button
                type="button"
                onClick={onShowAttention}
                aria-label={`${attentionCount} flow${attentionCount === 1 ? "" : "s"} need attention`}
                title="Flows that need attention"
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px normal-case tabular-nums",
                  attentionCount > 0
                    ? "border-amber-400/50 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                    : "border-border text-muted-foreground"
                )}
              >
                <BellRing className="h-3 w-3" aria-hidden /> {attentionCount}
              </button>
            )}
          </span>
          <span className="flex items-center gap-1">
            {onAddCurrency && (
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onAddCurrency} aria-label="Add currency" title="Add currency: set up the flows for a foreign-currency budget">
                <Coins className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button size="sm" variant="outline" className="text-xs" onClick={onCreate} aria-label="Create sync flow">
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          </span>
        </div>
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search flows"
          aria-label="Search sync flows"
          size="default"
          className="w-full"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {flows.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-sm font-medium">No sync flows yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Create one to copy data between two budgets.</p>
            <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={onCreate}><Plus className="h-3.5 w-3.5" /> New flow</Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">No flows match “{search}”.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {ordered.map((flow, index) => {
              const groupName = flowGroupName(flow);
              const startsGroup = !!groupName && (index === 0 || flowGroupName(ordered[index - 1]) !== groupName);
              const endsGroups = !groupName && index > 0 && !!flowGroupName(ordered[index - 1]);
              const selected = flow.id === selectedFlowId;
              const config = decodeFlowPlanConfig(flow);
              const connected =
                connectionAvailable(
                  config.sourceConnectionFingerprint,
                  config.sourceBudgetId,
                  connections
                ) &&
                connectionAvailable(
                  config.targetConnectionFingerprint,
                  config.targetBudgetId,
                  connections
                );
              const latestRun = latestRuns.get(flow.id);
              const enginePause = enginePauses.get(flow.id) ?? null;
              // Either kind of pause means "this is not running", and the badge
              // has to say so for both - an engine health-pause used to leave
              // the row looking perfectly healthy.
              const autoPaused = (!flow.enabled && !!config.autoPausedAt) || !!enginePause;
              const lastRunMs = latestRun ? new Date(latestRun.finishedAt ?? latestRun.startedAt).getTime() : null;
              const src = config.sourceConnectionFingerprint;
              const tgt = config.targetConnectionFingerprint;
              const bothEnrolled =
                isEnrolled(enrolled, src, config.sourceBudgetId) && isEnrolled(enrolled, tgt, config.targetBudgetId);
              // Runs on the server, so it needs nothing connected in this tab.
              const runsOnServer = config.reviewPolicy === "auto_sync_unattended" && bothEnrolled;
              const unattended = computeUnattendedStatus({
                reviewPolicy: config.reviewPolicy,
                flowEnabled: flow.enabled,
                autoPaused: !!config.autoPausedAt,
                enginePause,
                vaultReady,
                bothEnrolled,
                lastRunAtMs: lastRunMs && !Number.isNaN(lastRunMs) ? lastRunMs : null,
                intervalMinutes: config.intervalMinutes,
                nowMs,
              });
              const attentionBadge = autoPaused
                ? "Auto-paused"
                : latestRun && runNeedsAttention(latestRun)
                  ? latestRun.status === "failed" || latestRun.status === "partial"
                    ? "Failed"
                    : `${runQueuedCount(latestRun)} to review`
                  : null;
              return (
                <Fragment key={flow.id}>
                {startsGroup && (
                  <div className="mt-1 flex items-center justify-between gap-1 px-2.5 py-1 first:mt-0">
                    <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" title={groupName}>{groupName}</span>
                    {onRunGroup && (
                      <Button size="xs" variant="ghost" onClick={() => onRunGroup(groupName)} aria-label={`Run all flows in ${groupName}`} title="Run this group in order">
                        <Play /> Run all
                      </Button>
                    )}
                  </div>
                )}
                {endsGroups && <div className="mx-2.5 my-1 border-t border-border" aria-hidden />}
                <button
                  type="button"
                  onClick={() => onSelect(flow.id)}
                  className={cn(
                    "w-full rounded-md px-2.5 py-2 text-left transition-colors",
                    selected ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-muted/60"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{flow.name}</span>
                    {flow.flowType !== "transaction_sync" && (
                      <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                        {flow.flowType === "payee_sync" ? "Payees" : "Categories"}
                      </span>
                    )}
                    <span
                      className={cn("h-2 w-2 shrink-0 rounded-full", flow.enabled ? "bg-green-500" : "bg-muted-foreground/40")}
                      aria-hidden
                    />
                    <span className="sr-only">{flow.enabled ? "Enabled" : "Disabled"}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    {connected || runsOnServer ? (
                      <>
                        <span className="truncate">{latestRunLabel(latestRun)}</span>
                        {attentionBadge && (
                          <span className="shrink-0 rounded-full border border-amber-400/40 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                            {attentionBadge}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">Needs connection</span>
                    )}
                  </div>
                  {config.reviewPolicy === "auto_sync_on_interval" && (
                    <div className="mt-0.5 text-[10.5px] text-amber-700 dark:text-amber-400">
                      This flow no longer runs automatically while Bench is open. Edit it to run it on a server
                      schedule.
                    </div>
                  )}
                  {unattended.isUnattended && !unattended.paused && (
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px]">
                      <span
                        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", unattended.armed ? "bg-green-500" : "bg-amber-500")}
                        aria-hidden
                      />
                      <span className="truncate text-muted-foreground">
                        {unattended.armed ? nextRunPhrase(unattended, nowMs) : unattended.reason}
                      </span>
                    </div>
                  )}
                </button>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
