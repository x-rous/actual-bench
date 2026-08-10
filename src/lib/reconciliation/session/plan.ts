/**
 * Staged decisions → the operation list Apply executes (feature spec §38/§39).
 *
 * Pure. Planning never touches Actual, and the plan is a deterministic function
 * of the session, so the review screen and the executor are guaranteed to be
 * looking at the same work.
 */

import { fnv1aHex } from "@/lib/sync/hash";
import type {
  ApplyOperation,
  ApplyPlan,
  CreateOperation,
  DeleteOperation,
  UpdateOperation,
} from "../apply/operations";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "../types";
import { canStageDelete, canStageField, hasStagedChanges, stagedFields } from "./staging";

export type PlanInput = {
  sessionId: string;
  budgetSyncId: string;
  accountId: string;
  items: ReconciliationItem[];
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
};

/**
 * The durable marker written to a created transaction (RD-071 D14).
 *
 * Derived from stable route identity plus the statement row's own fingerprint,
 * so the same row in the same session always produces the same marker no matter
 * how many times Apply is retried. Deliberately *not* derived from anything
 * random, local, or display-shaped — the same rule Budget File Sync follows.
 */
export function createMarker(input: {
  budgetSyncId: string;
  accountId: string;
  sessionId: string;
  fingerprint: string;
}): string {
  return `recon:${fnv1aHex(
    `${input.budgetSyncId}|${input.accountId}|${input.sessionId}|${input.fingerprint}`
  )}`;
}

export function buildApplyPlan(input: PlanInput): ApplyPlan {
  const operations: ApplyOperation[] = [];
  const blocked: { itemId: string; reason: string }[] = [];
  let noWriteMatches = 0;
  let unresolved = 0;

  for (const item of input.items) {
    switch (item.disposition) {
      case "create": {
        const row = input.statementRows.get(item.statementRowIds[0] ?? "");
        if (!row) break;
        operations.push(createOperationFor(item, row, input));
        break;
      }

      // An amount correction resolves a review item: the transaction is the
      // right one, its amount is simply wrong. It stays an update in place, so
      // the id, notes, payee, category and any schedule or transfer link
      // survive — nothing the user wrote is destroyed to fix a number.
      case "correct-amount":
      case "matched": {
        const transaction = input.transactions.get(item.actualTransactionIds[0] ?? "");
        if (!transaction) break;

        if (!hasStagedChanges(item.stagedChanges)) {
          if (item.disposition === "correct-amount") break;
          // Reconciled, but nothing to write. Counting this as a change is how
          // an Apply button ends up offering to make 248 changes when 12 were
          // meant (feature spec §39).
          noWriteMatches += 1;
          break;
        }

        // Defence in depth: staging already refuses these, but the plan is the
        // last point before a write and must not rely on the UI having behaved.
        const refused = stagedFields(item.stagedChanges).find(
          (field) => !canStageField(item, field).allowed
        );
        if (refused) {
          const verdict = canStageField(item, refused);
          blocked.push({
            itemId: item.id,
            reason: verdict.allowed ? "Blocked" : verdict.reason,
          });
          break;
        }

        operations.push(updateOperationFor(item, transaction));
        break;
      }

      case "delete": {
        const transaction = input.transactions.get(item.actualTransactionIds[0] ?? "");
        if (!transaction) break;

        const verdict = canStageDelete(item);
        if (!verdict.allowed) {
          blocked.push({ itemId: item.id, reason: verdict.reason });
          break;
        }

        operations.push(deleteOperationFor(item, transaction));
        break;
      }

      case "keep":
      case "ignored":
        // Explicitly resolved with no write. Not a gap, not a change.
        noWriteMatches += 1;
        break;

      default:
        unresolved += 1;
    }
  }

  return { operations, noWriteMatches, unresolved, blocked };
}

function operationId(kind: string, itemId: string): string {
  // Stable across replans so a retry addresses the same operation.
  return `${kind}:${itemId}`;
}

function createOperationFor(
  item: ReconciliationItem,
  row: StatementRow,
  input: PlanInput
): CreateOperation {
  const patch = item.stagedChanges;
  return {
    id: operationId("create", item.id),
    kind: "create",
    itemId: item.id,
    statementRowId: row.id,
    accountId: input.accountId,
    // The statement is authoritative for the posted date and amount, but a
    // staged date wins because the user set it deliberately.
    date: patch?.date?.staged ?? row.postedDate,
    amount: row.amount,
    payeeId: patch?.payeeId?.staged ?? null,
    // Falls back to the bank's own text so a created transaction is never
    // anonymous, even when no payee was chosen.
    payeeName: patch?.payeeId?.staged ? null : row.description || null,
    categoryId: patch?.categoryId?.staged ?? null,
    notes: patch?.notes?.staged ?? null,
    marker: createMarker({
      budgetSyncId: input.budgetSyncId,
      accountId: input.accountId,
      sessionId: input.sessionId,
      fingerprint: row.fingerprint,
    }),
  };
}

function updateOperationFor(
  item: ReconciliationItem,
  transaction: ActualTransactionSnapshot
): UpdateOperation {
  return {
    id: operationId("update", item.id),
    kind: "update",
    itemId: item.id,
    transactionId: transaction.id,
    accountId: transaction.accountId,
    date: transaction.date,
    amount: transaction.amount,
    patch: item.stagedChanges ?? {},
  };
}

function deleteOperationFor(
  item: ReconciliationItem,
  transaction: ActualTransactionSnapshot
): DeleteOperation {
  return {
    id: operationId("delete", item.id),
    kind: "delete",
    itemId: item.id,
    transactionId: transaction.id,
    accountId: transaction.accountId,
    date: transaction.date,
    amount: transaction.amount,
  };
}
