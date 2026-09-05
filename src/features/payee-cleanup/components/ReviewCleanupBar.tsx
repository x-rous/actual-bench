import { AlertTriangle } from "lucide-react";
import type { PlanProblem } from "../lib/plan";
import type { StageOutcome } from "../hooks/usePayeeCleanupPlan";

type Props = {
  /** Merges already staged and waiting to be saved on the Payees page. */
  stagedCount: number;
  outcome: StageOutcome | null;
};

/**
 * Only what needs attention (RD-078 §22, M6).
 *
 * The routine "what will be staged" counts live in the Pending changes box,
 * alongside the safety line, so this renders nothing at all on a normal pass.
 * What remains is the three things a user must not miss: work already staged
 * and waiting to be saved, a plan that cannot be staged, and a plan built on
 * payees that have since changed.
 *
 * The "N changes staged" confirmation is deliberately *not* here — it is a
 * moment, not a state, so it goes to a toast and leaves. The standing reminder
 * that staged work is still unsaved is the part that has to persist.
 */
export function ReviewCleanupBar({ stagedCount, outcome }: Props) {
  const blocking = outcome?.status === "blocked" ? outcome.problems : [];
  const hasSomethingToSay =
    stagedCount > 0 || blocking.length > 0 || outcome?.status === "stale";

  // Routine counts moved into the Pending changes box. What is left is only
  // what needs attention, so on a normal pass this renders nothing at all.
  if (!hasSomethingToSay) return null;

  return (
    <div className="mx-4 mt-3 space-y-2">
      {stagedCount > 0 ? (
        // Staged work is invisible from this page once its suggestions are
        // gone. Without this, a user could stage twenty merges, see an empty
        // list, and close the tab believing they were done.
        <p className="rounded border border-emerald-600/40 bg-emerald-500/5 p-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          {stagedCount} {stagedCount === 1 ? "change is" : "changes are"} staged and
          waiting - open the Payees page and save to apply them.
        </p>
      ) : null}

      {outcome?.status === "stale" ? (
        <p className="flex items-start gap-2 rounded border border-amber-600/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {outcome.changedCount}{" "}
            {outcome.changedCount === 1 ? "payee has" : "payees have"} changed since
            this cleanup was prepared. Scan again so you are deciding on what the
            budget holds now.
          </span>
        </p>
      ) : null}

      {blocking.length > 0 ? (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-2">
          <p className="flex items-center gap-2 text-xs font-medium text-destructive">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            This cleanup cannot be staged yet
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-destructive">
            {blocking.map((problem: PlanProblem, index) => (
              <li key={`${problem.payeeIds.join()}-${index}`}>{problem.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
