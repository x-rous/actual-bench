import type { ActualBenchTransport } from "@/lib/actual/transport";
import { executeOutput, type ExecutorOutcome } from "@/lib/assets-debt/services/applyService";
import type { Proposal } from "@/lib/assets-debt/tracking/proposals";
import { generateId } from "@/lib/uuid";
import { startTiming } from "./debugTiming";
import { withLoanOperation } from "./operationGate";
import { finishWrite, startWrite } from "./trackingApi";

/**
 * Applying a loan's writes to Actual, one at a time (design spec 06 §8). Every write is the user's explicit Apply:
 * - one sync before the run;
 * - each write is first recorded in the journal (`debt_writes`), which refuses a second write in flight;
 * - the shared executor writes, refusing before any change when the rows differ from what was planned, and verifies;
 * - the journal records how it ended; the run stops at the first write that did not apply;
 * - loan-side rows Actual made for the splits are marked cleared again in one call at the end (Direct only).
 */

export type WriteOutcome = { proposal: Proposal; status: "applied" | "failed" | "uncertain" | "not-started"; message: string | null };

export type WriteContext = {
  connectionId: string;
  debtId: string;
  transport: ActualBenchTransport;
  liabilityAccountId: string;
  transferPayeeByAccount: Record<string, string>;
  offBudgetAccountIds: ReadonlySet<string>;
};

const kindOf: Record<Proposal["kind"], "split" | "convert" | "create" | "adjust-split" | "undo-split"> = { split: "split", convert: "convert", create: "create", "adjust-split": "adjust-split", "undo-split": "undo-split" };

function messageOf(outcome: ExecutorOutcome): string | null {
  if (outcome.status === "applied") return null;
  const error = outcome.error as { message?: unknown; issues?: Array<{ detail?: string }> };
  if (typeof error.message === "string") return error.message;
  if (Array.isArray(error.issues) && error.issues.length) return error.issues.map((i) => i.detail ?? "").filter(Boolean).join("; ") || "Verification found a difference.";
  return "The write did not complete.";
}

export async function applyProposals(ctx: WriteContext, proposals: readonly Proposal[], onProgress?: (done: number, total: number) => void, shouldStop?: () => boolean): Promise<{ outcomes: WriteOutcome[]; clearingProblem: string | null }> {
  return withLoanOperation(ctx.connectionId, async () => {
    const timing = startTiming(`apply ${proposals.length} loan write(s)`);
    const outcomes: WriteOutcome[] = proposals.map((proposal) => ({ proposal, status: "not-started", message: null }));
    await ctx.transport.sync();
    timing.step("sync");
    const batchId = proposals.length > 1 ? generateId() : null;
    const clearLater: string[] | undefined = ctx.transport.batchWriteTransactionsForSync && proposals.length > 1 ? [] : undefined;
    for (let i = 0; i < proposals.length; i++) {
      if (shouldStop?.()) break;
      const proposal = proposals[i];
      const marker = proposal.output.kind === "create" ? proposal.output.operations[0]?.importedId ?? null : null;
      let writeId: string;
      try {
        const write = await startWrite(ctx.debtId, { batchId, kind: kindOf[proposal.kind], installmentDueDate: proposal.dueDate, targetIds: proposal.targetIds, before: proposal.output, after: proposal.output.kind, marker });
        writeId = write.id;
      } catch (error) {
        outcomes[i] = { proposal, status: "failed", message: error instanceof Error ? error.message : String(error) };
        break;
      }
      let outcome: ExecutorOutcome;
      try {
        outcome = await executeOutput(proposal.output, { transport: ctx.transport, transferPayeeByAccount: ctx.transferPayeeByAccount, offBudgetAccountIds: ctx.offBudgetAccountIds, liabilityAccountId: ctx.liabilityAccountId, clearLater });
      } catch (error) {
        outcome = { status: "indeterminate", error: { stage: "executor", message: error instanceof Error ? error.message : String(error) } };
      }
      const status = outcome.status === "applied" ? "applied" : outcome.status === "failed" ? "failed" : "uncertain";
      outcomes[i] = { proposal, status, message: messageOf(outcome) };
      await finishWrite(ctx.debtId, writeId, { status, actualIds: outcome.status === "applied" ? outcome.actualIds : null, ...(outcome.status !== "applied" ? { error: outcome.error } : {}) }).catch(() => undefined);
      timing.step(`write ${i + 1}`);
      onProgress?.(i + 1, proposals.length);
      if (status !== "applied") break;
    }
    let clearingProblem: string | null = null;
    if (clearLater?.length) {
      try {
        await ctx.transport.batchWriteTransactionsForSync!({ updated: clearLater.map((id) => ({ id, cleared: true })), deleted: [] });
        const rows = await ctx.transport.listTransactionsForSync({ accountId: ctx.liabilityAccountId, resolveNames: false });
        const notCleared = clearLater.filter((id) => !rows.some((r) => r.id === id && r.cleared));
        if (notCleared.length) clearingProblem = `${notCleared.length} loan-side row${notCleared.length === 1 ? " was" : "s were"} not marked cleared. Mark ${notCleared.length === 1 ? "it" : "them"} cleared in Actual.`;
      } catch (error) {
        clearingProblem = `The splits were applied, but marking the loan-side rows cleared again did not complete (${error instanceof Error ? error.message : String(error)}). Mark them cleared in Actual.`;
      }
      timing.step("clear");
    }
    timing.end();
    return { outcomes, clearingProblem };
  });
}
