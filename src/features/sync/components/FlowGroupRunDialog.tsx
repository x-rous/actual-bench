"use client";

import { useState } from "react";
import { CheckCircle2, CircleDashed, Loader2, TriangleAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { decodeFlowPlanConfig } from "@/lib/sync/flowConfig";
import type { SyncFlow } from "@/lib/app-db/types";
import type { ConnectionInstance } from "@/store/connection";
import { runClientPreview, runClientSafeSync } from "../lib/clientOrchestration";
import { orderFlowsForRun, runFlowGroup, type GroupRunOutcome } from "../lib/flowGroups";
import { runFlowNow } from "../lib/syncApi";

const STATE_LABEL: Record<GroupRunOutcome["state"], string> = {
  applied: "Synced",
  previewed: "Previewed",
  no_changes: "No changes",
  attention: "Needs attention",
  skipped: "Skipped",
  failed: "Failed",
};

function StateIcon({ state }: { state: GroupRunOutcome["state"] }) {
  if (state === "failed") return <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />;
  if (state === "attention") return <TriangleAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden />;
  if (state === "skipped" || state === "previewed") return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />;
  return <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" aria-hidden />;
}

function policyLabel(flow: SyncFlow): string {
  return decodeFlowPlanConfig(flow).reviewPolicy === "manual_preview_required" ? "Preview only" : "Safe items";
}

export function FlowGroupRunDialog({ name, flows, connections, runsOnServer, onClose, onFinished }: {
  name: string;
  flows: SyncFlow[];
  connections: ConnectionInstance[];
  runsOnServer: (flow: SyncFlow) => boolean;
  onClose: () => void;
  onFinished: () => void;
}) {
  const ordered = orderFlowsForRun(flows);
  const [outcomes, setOutcomes] = useState<GroupRunOutcome[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "running" | "done">("idle");

  async function start() {
    setState("running");
    setOutcomes([]);
    await runFlowGroup(ordered, connections, {
      runPreview: (input) => runClientPreview({ ...input, allowDisabled: false }),
      runSafe: (input) => runClientSafeSync({ ...input, allowDisabled: false }),
      runOnServer: runFlowNow,
      runsOnServer,
    }, (next, flowId) => {
      setOutcomes(next);
      setRunningId(flowId);
    });
    setRunningId(null);
    setState("done");
    onFinished();
  }

  const outcomeFor = (flowId: string) => outcomes.find((outcome) => outcome.flowId === flowId);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && state !== "running") onClose(); }}>
      <DialogContent className="w-[92vw] sm:max-w-[920px]">
        <DialogHeader><DialogTitle>Run group: {name}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Runs in this order. Automated flows apply safe items only. Manual flows are previewed and write nothing.
        </p>
        <div className="max-h-[56vh] overflow-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="[&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium"><th>Flow</th><th>Mode</th><th>Result</th><th>Details</th></tr>
            </thead>
            <tbody>
              {ordered.map((flow) => {
                const outcome = outcomeFor(flow.id);
                return (
                  <tr key={flow.id} className="border-t border-border/60 [&>td]:whitespace-nowrap [&>td]:px-2 [&>td]:py-1.5">
                    <td className="max-w-72 truncate font-medium" title={flow.name}>{flow.name}</td>
                    <td className="text-muted-foreground">{policyLabel(flow)}</td>
                    <td>
                      {runningId === flow.id ? (
                        <span className="inline-flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Running</span>
                      ) : outcome ? (
                        <span className="inline-flex items-center gap-1"><StateIcon state={outcome.state} /> {STATE_LABEL[outcome.state]}</span>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">Waiting</Badge>
                      )}
                    </td>
                    <td className="max-w-80 truncate text-muted-foreground" title={outcome?.detail}>{outcome?.detail ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={state === "running"}>Close</Button>
          <Button onClick={() => void start()} disabled={state === "running"}>
            {state === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {state === "done" ? "Run again" : "Run all"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
