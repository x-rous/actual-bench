"use client";

import { Badge } from "@/components/ui/badge";
import type { SyncFlowRun } from "@/lib/app-db/types";

type RunHistoryProps = {
  runs: SyncFlowRun[];
  onSelectRun: (runId: string) => void;
};

function runCount(run: SyncFlowRun, key: string): number {
  const value = run.counts?.data?.[key];
  return typeof value === "number" ? value : 0;
}

export function RunHistory({ runs, onSelectRun }: RunHistoryProps) {
  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">No runs yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {runs.map((run) => (
        <li key={run.id}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted/50"
            onClick={() => onSelectRun(run.id)}
          >
            <span className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px] capitalize">
                {run.status.replace(/_/g, " ")}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(run.startedAt).toLocaleString()}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {runCount(run, "new") || runCount(run, "applied")} items
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
