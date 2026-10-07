"use client";

import { Check, Circle, CircleDot, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bulkSummary, type BulkResult, type BulkStep } from "./bulkApply";

/**
 * The bulk apply while it runs (owner review 2026-10-07): the confirmation turns into progress in
 * the same dialog, which cannot be closed until the batch has finished, because the months depend
 * on each other and closing mid-way would hide where it stopped. Each change shows done, running,
 * waiting, failed or not run; the user can stop after the current change; the loan-side rows marked
 * cleared again and the refresh from Actual show as their own steps; the end says what happened.
 */

export type BulkRunPhase = "applying" | "clearing" | "refreshing" | "done";

export type BulkRun = {
  steps: BulkStep[];
  /** Changes finished (the one running is `steps[done]`). */
  done: number;
  phase: BulkRunPhase;
  stopRequested: boolean;
  /** Loan-side rows to mark cleared again in one write at the end. */
  clearing: number;
  result: BulkResult | null;
  /** The cleared marks did not all take (the splits themselves are applied). */
  clearProblem: string | null;
};

type RowState = "applied" | "running" | "waiting" | "failed" | "not-run";

function stateOf(run: BulkRun, index: number): RowState {
  const key = run.steps[index].row.key;
  if (run.result) {
    if (run.result.applied.some((r) => r.key === key)) return "applied";
    if (run.result.stopped?.row.key === key) return "failed";
    return "not-run";
  }
  if (index < run.done) return "applied";
  if (index === run.done && run.phase === "applying") return "running";
  return "waiting";
}

const ICON: Record<RowState, { icon: typeof Check; label: string; className: string }> = {
  applied: { icon: Check, label: "Applied", className: "text-emerald-600 dark:text-emerald-400" },
  running: { icon: CircleDot, label: "Applying", className: "text-primary animate-pulse" },
  waiting: { icon: Circle, label: "Waiting", className: "text-muted-foreground" },
  failed: { icon: X, label: "Stopped here", className: "text-destructive" },
  "not-run": { icon: Minus, label: "Not applied", className: "text-muted-foreground" },
};

export function BulkApplyDialog({ run, headline, onStop, onDone, onContinue }: {
  run: BulkRun | null;
  headline: (step: BulkStep) => string;
  onStop: () => void;
  onDone: () => void;
  /** Close and select the changes that were not applied (recalculated) to review and apply. */
  onContinue: () => void;
}) {
  if (!run) return null;
  const total = run.steps.length;
  const finished = run.phase === "done";
  const current = run.phase === "applying" ? run.steps[run.done] : undefined;
  const status = run.phase === "applying"
    ? `Applying ${Math.min(run.done + 1, total)} of ${total}${current ? ` - due ${current.row.dueDate}` : ""}${run.stopRequested ? ". Stopping after this change" : ""}`
    : run.phase === "clearing"
      ? `Marking ${run.clearing} loan-side row${run.clearing === 1 ? "" : "s"} cleared again`
      : run.phase === "refreshing"
        ? "Reading Actual again and recalculating the rest"
        : run.result ? bulkSummary(run.result) : "";
  const percent = finished ? 100 : Math.round((Math.min(run.done, total) / Math.max(1, total)) * 100);
  const left = run.result?.notAttempted.length ?? 0;
  return (
    // Not closable while it runs: Escape and clicks outside are ignored until the batch is done.
    <Dialog open onOpenChange={(open) => { if (!open && finished) onDone(); }}>
      <DialogContent showCloseButton={finished} className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{finished ? (run.result?.stopped ? "Bulk apply stopped" : "Bulk apply finished") : `Applying ${total} change${total === 1 ? "" : "s"} to Actual`}</DialogTitle>
          <DialogDescription>{finished ? "Actual has been read again and the rest recalculated." : "Keep this page open until it finishes. Each change is checked against Actual just before it is written."}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <div role="progressbar" aria-label="Bulk apply progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={finished ? total : run.done} className="h-2 overflow-hidden rounded bg-muted">
            <div className={run.result?.stopped ? "h-full bg-amber-500 transition-all" : "h-full bg-primary transition-all"} style={{ width: `${percent}%` }} />
          </div>
          <p aria-live="polite" className={run.result?.stopped ? "text-xs text-amber-800 dark:text-amber-300" : "text-xs"}>{status}</p>
          {run.clearProblem ? <p role="alert" className="text-xs text-destructive">{run.clearProblem}</p> : null}
        </div>
        <div className="max-h-[50vh] overflow-y-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background text-left text-muted-foreground"><tr><th scope="col" className="w-8 px-3 py-1.5 font-normal"><span className="sr-only">State</span></th><th scope="col" className="px-3 py-1.5 font-normal">Due</th><th scope="col" className="px-3 py-1.5 font-normal">Change</th></tr></thead>
            <tbody>
              {run.steps.map((step, index) => {
                const state = stateOf(run, index);
                const { icon: Icon, label, className } = ICON[state];
                const reason = state === "failed" ? run.result?.stopped?.reason : null;
                return (
                  <tr key={step.row.key} data-state={state} className={state === "running" ? "border-t border-border/60 bg-muted/50" : "border-t border-border/60"}>
                    <td className="px-3 py-1.5"><Icon aria-label={label} className={`size-3.5 ${className}`} /></td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{step.row.dueDate}</td>
                    <td className="px-3 py-1.5">{headline(step)}{reason ? <span className="block text-destructive">{reason}</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DialogFooter className="gap-2">
          {finished ? (
            <>
              {left > 0 ? <Button type="button" variant="outline" onClick={onContinue}>Refresh and continue</Button> : null}
              <Button type="button" onClick={onDone}>Done</Button>
            </>
          ) : (
            <Button type="button" variant="outline" disabled={run.phase !== "applying" || run.stopRequested || run.done >= total - 1} onClick={onStop}>
              {run.stopRequested ? "Stopping after this change" : "Stop after this change"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
