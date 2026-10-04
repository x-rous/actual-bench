import type { ActualBenchTransport } from "@/lib/actual/transport";
import { executeApprovedPosting, type ExecutorOutcome } from "@/lib/assets-debt/services/applyService";
import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import { recoverPosting } from "@/lib/assets-debt/services/recovery";
import { indexReadRows, type PostingOutputSnapshot, type RowSnapshot } from "@/lib/assets-debt/services/snapshot";
import { approveAndApply, beginCompleteLink, recordOutcome } from "./postingsApi";

/**
 * The user's posting actions in the browser (RD-084 P1.6 T125–T137; SC-018).
 *
 * This is the only module that calls the apply executor, and it does so only
 * inside these functions, which the preview binds to explicit button clicks:
 *
 * - `applyPosting`: **Apply this change**. Re-reads the target rows, asks the
 *   server to re-run preflight and record the decision, and only with the
 *   ticket it returns runs the executor; then records the outcome.
 * - `checkInterruptedPosting`: a read-only recovery look at Actual.
 * - `completeInterruptedLink`: **Complete the transfer link**, the explicit
 *   second call of an interrupted link the user already approved.
 */

export type PostingActionContext = {
  transport: ActualBenchTransport;
  liabilityAccountId: string;
  transferPayeeByAccount: Record<string, string>;
  offBudgetAccountIds: ReadonlySet<string>;
};

function rowsToRecheck(output: PostingOutputSnapshot): RowSnapshot[] {
  switch (output.kind) {
    case "restructure": return [output.before];
    case "link": return [output.sourceBefore, output.counterpartBefore];
    case "claim": return output.release ? [] : output.rows;
    case "create": return [];
  }
}

/** Re-read the rows a posting targets, just before Apply, for the server's preflight (FR-162). */
export async function rereadTargets(posting: PostingView, transport: ActualBenchTransport): Promise<RowSnapshot[]> {
  const targets = rowsToRecheck(posting.output);
  const fresh: RowSnapshot[] = [];
  for (const accountId of [...new Set(targets.map((t) => t.accountId))]) {
    const from = targets.filter((t) => t.accountId === accountId).reduce((min, t) => (t.date < min ? t.date : min), "9999-12-31");
    const index = indexReadRows(await transport.listTransactionsForSync({ accountId, startDate: from }));
    for (const target of targets.filter((t) => t.accountId === accountId)) {
      const row = index.get(target.id);
      if (row) fresh.push(row);
    }
  }
  return fresh;
}

export async function applyPosting(posting: PostingView, ctx: PostingActionContext): Promise<PostingView> {
  const fresh = await rereadTargets(posting, ctx.transport);
  const ticket = await approveAndApply(posting.id, fresh);
  let outcome: ExecutorOutcome;
  try {
    outcome = await executeApprovedPosting(ticket, ctx);
  } catch (error) {
    outcome = { status: "indeterminate", error: { stage: "executor", message: error instanceof Error ? error.message : String(error) } };
  }
  return recordOutcome(posting.id, outcome);
}

export type CheckResult = { posting: PostingView } | { needsCompletion: string };

export async function checkInterruptedPosting(posting: PostingView, ctx: PostingActionContext): Promise<CheckResult> {
  const result = await recoverPosting(posting.output, ctx.transport, ctx.transferPayeeByAccount);
  if (result.status === "needs-completion") return { needsCompletion: result.detail };
  if (result.status === "applied") return { posting: await recordOutcome(posting.id, { status: "applied", actualIds: result.actualIds, appliedAt: new Date().toISOString(), recovered: true }) };
  return { posting: await recordOutcome(posting.id, { status: "not-found", reason: result.reason }) };
}

export async function completeInterruptedLink(posting: PostingView, ctx: PostingActionContext): Promise<PostingView> {
  const ticket = await beginCompleteLink(posting.id);
  let outcome: ExecutorOutcome;
  try {
    outcome = await executeApprovedPosting(ticket, ctx);
  } catch (error) {
    outcome = { status: "indeterminate", error: { stage: "executor", message: error instanceof Error ? error.message : String(error) } };
  }
  if (outcome.status === "applied") return recordOutcome(posting.id, outcome);
  return posting;
}
