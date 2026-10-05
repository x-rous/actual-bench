import type { ActualBenchTransport } from "@/lib/actual/transport";
import { executeApprovedPosting, type ExecutorOutcome } from "@/lib/assets-debt/services/applyService";
import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import { recoverPosting } from "@/lib/assets-debt/services/recovery";
import { indexReadRows, type PostingOutputSnapshot, type RowSnapshot } from "@/lib/assets-debt/services/snapshot";
import { startTiming } from "./debugTiming";
import { approveAndApply, approveAndRecordClaim, beginCompleteLink, recordOutcome } from "./postingsApi";

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
    case "restructure": return output.replacesCounterpart ? [output.before, output.replacesCounterpart] : [output.before];
    case "link": return [output.sourceBefore, output.counterpartBefore];
    case "claim": return output.release ? [] : output.rows;
    case "create": return [];
    case "restore-split": return [output.parent, ...output.children];
    case "unlink": return [output.source, output.counterpart];
    case "convert": return [output.before];
    case "revert-convert": return [output.converted, output.counterpart];
  }
}

/** Rows read once for a whole batch of claims (they write nothing, so the rows cannot change in between). */
export type ReadCache = Map<string, RowSnapshot>;

/** Re-read the rows a posting targets, just before Apply, for the server's preflight (FR-162). */
export async function rereadTargets(posting: PostingView, transport: ActualBenchTransport, cache?: ReadCache): Promise<RowSnapshot[]> {
  const targets = rowsToRecheck(posting.output);
  if (cache && targets.every((t) => cache.has(t.id))) return targets.map((t) => cache.get(t.id)!);
  const fresh: RowSnapshot[] = [];
  for (const accountId of [...new Set(targets.map((t) => t.accountId))]) {
    const dates = targets.filter((t) => t.accountId === accountId).map((t) => t.date);
    const from = dates.reduce((min, d) => (d < min ? d : min), "9999-12-31");
    const to = dates.reduce((max, d) => (d > max ? d : max), "0000-01-01");
    const index = indexReadRows(await transport.listTransactionsForSync({ accountId, startDate: from, endDate: to }));
    for (const target of targets.filter((t) => t.accountId === accountId)) {
      const row = index.get(target.id);
      if (row) fresh.push(row);
    }
  }
  return fresh;
}

/**
 * One read per account covering every claim in a batch (rev 4 speed). Only claims use it: a write
 * changes rows, so every other change still re-reads Actual just before it applies.
 */
export async function readForClaims(postings: readonly PostingView[], transport: ActualBenchTransport): Promise<ReadCache> {
  const targets = postings.filter((p) => p.output.kind === "claim" && !p.output.release).flatMap((p) => rowsToRecheck(p.output));
  const cache: ReadCache = new Map();
  for (const accountId of [...new Set(targets.map((t) => t.accountId))]) {
    const dates = targets.filter((t) => t.accountId === accountId).map((t) => t.date).sort();
    for (const row of indexReadRows(await transport.listTransactionsForSync({ accountId, startDate: dates[0], endDate: dates[dates.length - 1] })).values()) cache.set(row.id, row);
  }
  return cache;
}

export async function applyPosting(posting: PostingView, ctx: PostingActionContext, cache?: ReadCache): Promise<PostingView> {
  const timing = startTiming(`apply ${String(posting.postingKind)}`);
  const fresh = await rereadTargets(posting, ctx.transport, cache);
  timing.step("re-read");
  // A claim writes nothing to Actual: the server approves and records it in one call.
  if (posting.output.kind === "claim" && !posting.output.release) {
    const recorded = await approveAndRecordClaim(posting.id, fresh);
    timing.step("server record");
    timing.end();
    return recorded;
  }
  const ticket = await approveAndApply(posting.id, fresh);
  timing.step("server check");
  let outcome: ExecutorOutcome;
  try {
    outcome = await executeApprovedPosting(ticket, ctx);
  } catch (error) {
    outcome = { status: "indeterminate", error: { stage: "executor", message: error instanceof Error ? error.message : String(error) } };
  }
  timing.step("write and verify");
  const recorded = await recordOutcome(posting.id, outcome);
  timing.step("record");
  timing.end();
  return recorded;
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
