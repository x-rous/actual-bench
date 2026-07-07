"use client";

import { Badge } from "@/components/ui/badge";
import { relativeTime, toRunRow, type RunTone } from "../lib/runsView";
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
    <div className="overflow-hidden rounded-md border border-border">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 text-left text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Status</th><th className="px-3 py-2">Trigger</th>
              <th className="px-3 py-2 text-right">Planned</th><th className="px-3 py-2 text-right">Created</th>
              <th className="px-3 py-2 text-right">Re-linked</th><th className="px-3 py-2 text-right">Failed</th>
              <th className="px-3 py-2">When</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const r = toRunRow(run);
              return (
                <tr key={r.id} className="cursor-pointer border-t border-border/60 hover:bg-muted/50" onClick={() => onSelectRun(r.id)}>
                  <td className="px-3 py-2"><Badge variant={TONE_VARIANT[r.tone]} className="text-[10px]">{r.statusLabel}</Badge></td>
                  <td className="px-3 py-2">{r.trigger}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.planned ?? "-"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.created ?? "-"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.relinked ?? "-"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.failed ?? "-"}</td>
                  <td className="px-3 py-2 text-muted-foreground" title={new Date(r.when).toLocaleString()}>{relativeTime(r.when)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
