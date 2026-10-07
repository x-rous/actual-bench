import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import { bulkOrder, type ChangeRowModel } from "./changeRows";

/**
 * Bulk apply (RD-084 P1.6b T290; FR-170b, `ux-loan-workspace.md` §3.8).
 *
 * The selected rows run one at a time through the same per-posting path as a
 * single Apply (server approval and preflight, the browser write, server
 * verification and outcome). Changes run oldest first and undos newest first.
 * The batch stops at the first failure, refused preflight or interrupted
 * write (owner refinement 1), or after the current change when the user asks it
 * to stop: the months depend on each other, so nothing
 * later runs on a broken basis. The caller then refreshes and recalculates the
 * remaining proposals before the user can continue.
 */

export type BulkStep = { row: ChangeRowModel; target: PostingView; action: "apply" | "undo" };

export type BulkResult = {
  applied: ChangeRowModel[];
  /** The step that stopped the batch, with the reason in plain words. */
  stopped: { row: ChangeRowModel; reason: string } | null;
  /** Steps never attempted because the batch stopped. */
  notAttempted: ChangeRowModel[];
  /** The user stopped the batch after a change (nothing failed). */
  userStopped?: boolean;
};

export function bulkSteps(selected: readonly ChangeRowModel[]): BulkStep[] {
  return bulkOrder(selected).flatMap((row): BulkStep[] => {
    if (row.selectable === "undo" && row.undo) return [{ row, target: row.undo, action: "undo" }];
    if (row.selectable === "apply" && row.posting) return [{ row, target: row.posting, action: "apply" }];
    return [];
  });
}

function stopReason(posting: PostingView): string {
  const status = String(posting.status);
  if (status === "indeterminate") return "the write was interrupted; check Actual on that row";
  if (status === "failed") return String((posting.error as { message?: unknown; issues?: Array<{ detail?: string }> } | null)?.issues?.[0]?.detail ?? (posting.error as { message?: unknown } | null)?.message ?? "verification found a problem");
  if (status === "superseded") return "Actual changed before apply";
  return `the change ended as ${status}`;
}

/** Run the steps in order; stop at the first one that is not applied. Never throws. */
export async function runBulk(steps: readonly BulkStep[], apply: (step: BulkStep) => Promise<PostingView>, onProgress?: (done: number, step: BulkStep | null) => void, shouldStop?: () => boolean): Promise<BulkResult> {
  const applied: ChangeRowModel[] = [];
  for (const [index, step] of steps.entries()) {
    if (index > 0 && shouldStop?.()) {
      onProgress?.(index, null);
      return { applied, stopped: null, notAttempted: steps.slice(index).map((s) => s.row), userStopped: true };
    }
    onProgress?.(index, step);
    let outcome: PostingView;
    try {
      outcome = await apply(step);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { applied, stopped: { row: step.row, reason: /preflight|changed/i.test(message) ? `Actual changed before apply (${message})` : message }, notAttempted: steps.slice(index + 1).map((s) => s.row) };
    }
    if (String(outcome.status) !== "applied") {
      return { applied, stopped: { row: step.row, reason: stopReason(outcome) }, notAttempted: steps.slice(index + 1).map((s) => s.row) };
    }
    applied.push(step.row);
  }
  onProgress?.(steps.length, null);
  return { applied, stopped: null, notAttempted: [] };
}

/** The summary line the user sees after a batch. */
export function bulkSummary(result: BulkResult): string {
  const applied = `${result.applied.length} applied`;
  if (result.userStopped) {
    const left = result.notAttempted.length;
    return `${applied} · stopped by you. ${left === 1 ? "The remaining change was" : `The remaining ${left} changes were`} not applied and ${left === 1 ? "has" : "have"} been recalculated.`;
  }
  if (!result.stopped) return applied;
  const left = result.notAttempted.length;
  const reason = result.stopped.reason.replace(/[.\s]+$/, "");
  const rest = left === 1
    ? " The remaining change was not applied and has been recalculated; review it before continuing."
    : left > 1 ? ` The remaining ${left} changes were not applied and have been recalculated; review them before continuing.` : "";
  return `${applied} · stopped at ${result.stopped.row.dueDate}: ${reason}.${rest}`;
}
