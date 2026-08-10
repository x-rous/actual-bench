"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApplyRunResult } from "@/lib/reconciliation/apply/executor";
import type { ApplyPlan } from "@/lib/reconciliation/apply/operations";

/**
 * What actually happened (feature spec §40).
 *
 * A partial failure is reported as a partial failure — not rounded up to
 * success, not rounded down to "it failed". The session survives it, and
 * retrying re-attempts only what did not succeed, so the honest number is also
 * the useful one.
 */

export type ApplyResultPanelProps = {
  plan: ApplyPlan;
  result: ApplyRunResult;
  isApplying: boolean;
  onRetry: () => void;
  onBack: () => void;
};

export function ApplyResultPanel({
  plan,
  result,
  isApplying,
  onRetry,
  onBack,
}: ApplyResultPanelProps) {
  const failures = result.results.filter((entry) => entry.status === "failed");
  const operationsById = new Map(plan.operations.map((operation) => [operation.id, operation]));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <div className="flex items-start gap-2">
        {result.complete ? (
          <CheckCircle2
            className="mt-0.5 h-5 w-5 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
        ) : (
          <AlertTriangle
            className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
        )}
        <div>
          <h2 className="text-sm font-semibold">
            {result.complete ? "Applied" : "Applied with problems"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {result.applied} change{result.applied === 1 ? "" : "s"} written
            {result.skipped > 0 && ` · ${result.skipped} already done`}
            {result.failed > 0 && ` · ${result.failed} failed`}
          </p>
        </div>
      </div>

      {result.skipped > 0 && (
        <p className="text-xs text-muted-foreground">
          Changes marked already done were written by an earlier attempt. They were recognised and
          left alone rather than repeated.
        </p>
      )}

      {failures.length > 0 && (
        <section className="rounded-md border border-destructive/40 p-3">
          <h3 className="mb-2 text-xs font-semibold">What failed</h3>
          <ul className="space-y-1.5 text-xs">
            {failures.map((failure) => {
              const operation = operationsById.get(failure.operationId);
              return (
                <li key={failure.operationId}>
                  <span className="font-medium">{operation?.kind ?? "Change"}</span>
                  <span className="text-muted-foreground"> — {failure.error}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Retrying re-attempts only these. Changes that succeeded are not written again.
          </p>
        </section>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-3">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          Back to the workbench
        </Button>
        {!result.complete && (
          <Button onClick={onRetry} disabled={isApplying}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Retry what failed
          </Button>
        )}
      </div>
    </div>
  );
}
