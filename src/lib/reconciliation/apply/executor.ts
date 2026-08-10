/**
 * Apply: turn the plan into writes (feature spec §39/§40).
 *
 * The contract, in order of importance:
 *
 * 1. **Never write twice.** A create that already succeeded is recognised by its
 *    marker and skipped, so retrying a half-applied session cannot duplicate a
 *    transaction. This is the whole reason the marker is deterministic.
 * 2. **Persist the outcome of each operation as it happens.** A crash between
 *    two writes must leave a record of the first, or the retry is blind.
 * 3. **Keep going where it is safe to.** One failure does not abandon the rest,
 *    but it is never hidden either.
 *
 * Writes are issued one at a time rather than in parallel: the Direct transport
 * serialises writes anyway, and a stable order makes a partial failure
 * intelligible ("stopped after 12 of 18") instead of arbitrary.
 */

import type { ReconciliationTransport } from "../ports";
import type { StagedPatch } from "../types";
import type {
  ApplyOperation,
  ApplyPlan,
  OperationResult,
} from "./operations";

export type ApplyProgress = {
  completed: number;
  total: number;
  operation: ApplyOperation;
};

export type ApplyExecutorInput = {
  plan: ApplyPlan;
  transport: ReconciliationTransport;
  /**
   * Markers already present in the account, from a read taken immediately
   * before Apply. A create whose marker is here has already run — in an earlier
   * attempt of this same session — and must not run again.
   */
  existingMarkers?: Set<string>;
  /** Results from a previous attempt, so applied operations are not repeated. */
  previousResults?: OperationResult[];
  /** Persist each outcome as it happens, so a crash mid-run is recoverable. */
  onResult?: (result: OperationResult) => Promise<void> | void;
  onProgress?: (progress: ApplyProgress) => void;
};

export type ApplyRunResult = {
  results: OperationResult[];
  applied: number;
  failed: number;
  skipped: number;
  /** True when every operation either applied or was safely skipped. */
  complete: boolean;
};

export async function executeApplyPlan(input: ApplyExecutorInput): Promise<ApplyRunResult> {
  const { plan, transport } = input;
  const existingMarkers = input.existingMarkers ?? new Set<string>();

  const alreadyApplied = new Map(
    (input.previousResults ?? [])
      .filter((result) => result.status === "applied")
      .map((result) => [result.operationId, result])
  );

  const results: OperationResult[] = [];
  let completed = 0;

  for (const operation of plan.operations) {
    input.onProgress?.({ completed, total: plan.operations.length, operation });
    completed += 1;

    // Re-running a session that partly succeeded: keep the earlier outcome
    // rather than issuing the write again.
    const previous = alreadyApplied.get(operation.id);
    if (previous) {
      results.push(previous);
      continue;
    }

    if (operation.kind === "create" && existingMarkers.has(operation.marker)) {
      const result: OperationResult = {
        operationId: operation.id,
        status: "skipped",
        skippedBecause: "This transaction was already created by an earlier attempt.",
      };
      results.push(result);
      await input.onResult?.(result);
      continue;
    }

    const result = await runOperation(operation, transport);
    results.push(result);
    // Persisted before the next write is attempted, so an interruption leaves a
    // truthful record of what has already happened.
    await input.onResult?.(result);
  }

  input.onProgress?.({
    completed,
    total: plan.operations.length,
    operation: plan.operations[plan.operations.length - 1],
  });

  const applied = results.filter((result) => result.status === "applied").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  return { results, applied, failed, skipped, complete: failed === 0 };
}

async function runOperation(
  operation: ApplyOperation,
  transport: ReconciliationTransport
): Promise<OperationResult> {
  try {
    switch (operation.kind) {
      case "create": {
        const [created] = await transport.createTransactions([
          {
            accountId: operation.accountId,
            date: operation.date,
            amount: operation.amount,
            payeeId: operation.payeeId,
            payeeName: operation.payeeName,
            categoryId: operation.categoryId,
            notes: operation.notes,
            importedId: operation.marker,
          },
        ]);
        return {
          operationId: operation.id,
          status: "applied",
          transactionId: created?.transactionId ?? null,
        };
      }

      case "update": {
        await transport.updateTransaction({
          transactionId: operation.transactionId,
          accountId: operation.accountId,
          date: patchValue(operation.patch, "date") ?? operation.date,
          amount: operation.amount,
          payeeId: patchValue(operation.patch, "payeeId"),
          categoryId: patchValue(operation.patch, "categoryId"),
          notes: patchValue(operation.patch, "notes"),
        });
        return {
          operationId: operation.id,
          status: "applied",
          transactionId: operation.transactionId,
        };
      }

      case "delete": {
        await transport.deleteTransaction({ transactionId: operation.transactionId });
        return {
          operationId: operation.id,
          status: "applied",
          transactionId: operation.transactionId,
        };
      }
    }
  } catch (error) {
    return {
      operationId: operation.id,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * A field's staged value, or `undefined` when it was not staged.
 *
 * `undefined` and `null` mean different things here: `undefined` is "leave this
 * alone", `null` is "clear it". Collapsing them would let an update wipe a
 * category the user never touched.
 */
function patchValue<K extends keyof StagedPatch>(
  patch: StagedPatch,
  field: K
): NonNullable<StagedPatch[K]>["staged"] | undefined {
  const entry = patch[field];
  return entry ? (entry.staged as NonNullable<StagedPatch[K]>["staged"]) : undefined;
}
