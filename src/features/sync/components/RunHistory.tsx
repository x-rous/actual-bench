"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatRunTimestamp, relativeTime, toRunRow, type RunTone } from "../lib/runsView";
import type { SyncFlowRun } from "@/lib/app-db/types";

type RunHistoryProps = {
  runs: SyncFlowRun[];
  onSelectRun: (runId: string) => void;
};

const TONE_VARIANT: Record<RunTone, "status-active" | "status-warning" | "secondary"> = {
  good: "status-active", warn: "status-warning", bad: "status-warning", neutral: "secondary",
};

export function RunHistory({ runs, onSelectRun }: RunHistoryProps) {
  if (runs.length === 0) {
    return <p className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">No runs yet.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Trigger</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">When</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const r = toRunRow(run);
              return (
                <tr
                  key={r.id}
                  tabIndex={0}
                  role="button"
                  className="cursor-pointer border-t border-border/60 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => onSelectRun(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectRun(r.id);
                    }
                  }}
                >
                  <td className="px-3 py-2 align-top"><Badge variant={TONE_VARIANT[r.tone]} className="text-[10px]">{r.statusLabel}</Badge></td>
                  <td className="px-3 py-2 align-top text-muted-foreground">{r.trigger}</td>
                  <td className={cn("px-3 py-2 align-top", r.tone === "bad" ? "text-destructive" : "text-foreground")}>{r.result}</td>
                  <td className="whitespace-nowrap px-3 py-2 align-top text-muted-foreground">
                    <div className="text-foreground">{formatRunTimestamp(r.when)}</div>
                    {r.when && <div className="text-[10px]">{relativeTime(r.when)}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
