"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SyncFlowAttention } from "@/lib/app-db/syncRunRepository";
import type { SyncFlow } from "@/lib/app-db/types";
import { formatRunTimestamp } from "../lib/runsView";

function Count({ value }: { value: number }) {
  return <span className={value > 0 ? "font-medium" : "text-muted-foreground"}>{value}</span>;
}

/** Every flow whose latest run left something to deal with, in one list. */
export function SyncAttentionDialog({ entries, flows, onOpenRun, onClose }: {
  entries: SyncFlowAttention[];
  flows: SyncFlow[];
  onOpenRun: (flowId: string, runId: string) => void;
  onClose: () => void;
}) {
  const nameOf = (flowId: string) => flows.find((flow) => flow.id === flowId)?.name ?? "Deleted flow";
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[92vw] sm:max-w-[1040px]">
        <DialogHeader><DialogTitle>Needs attention</DialogTitle></DialogHeader>
        {entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nothing needs attention. Every flow&apos;s latest run is clear.</p>
        ) : (
          <div className="max-h-[64vh] overflow-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="[&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                  <th>Flow</th><th>Latest run</th><th className="text-right">Failed</th><th className="text-right">Waiting for rate</th>
                  <th className="text-right">Blocked</th><th className="text-right">To review</th><th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.flowId} className="border-t border-border/60 hover:bg-muted/40 [&>td]:whitespace-nowrap [&>td]:px-2 [&>td]:py-1 tabular-nums">
                    <td className="max-w-64 truncate">
                      <button type="button" className="max-w-full truncate font-medium underline-offset-2 hover:underline" onClick={() => onOpenRun(entry.flowId, entry.runId)} title="Open this run">
                        {nameOf(entry.flowId)}
                      </button>
                    </td>
                    <td className="text-muted-foreground">{formatRunTimestamp(entry.at)}</td>
                    <td className="text-right"><Count value={entry.failed} /></td>
                    <td className="text-right"><Count value={entry.waitingForRate} /></td>
                    <td className="text-right"><Count value={entry.blocked} /></td>
                    <td className="text-right"><Count value={entry.review} /></td>
                    <td className="max-w-72 truncate text-muted-foreground" title={entry.error ?? undefined}>{entry.error ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
