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
import { prospectiveTransaction } from "./prospective";
import { canStageDelete, canStageField, hasStagedChanges, stagedFields } from "./staging";

/**
 * How a staged decision becomes a write, as distinct from how rows are matched.
 *
 * The bank's merchant text is **not** configurable: it always becomes Actual's
 * `imported_payee` on a created transaction (RD-072 §2.2). That is provenance —
 * what the bank called this transaction — and it is not in competition with the
 * payee you curate or the note you write. What *is* configurable is which of
 * those two the statement's text should also seed.
 */
export type ApplyConfig = {
  /**
   * Where a created transaction's Payee comes from.
   *
   * `imported-payee` resolves the bank's merchant text into an Actual payee,
   * which is what a merchant name is for. `leave-unset` suits a curated payee
   * list the bank's raw text should not be added to — Actual's rules run on
   * create and can set the payee themselves, and the raw text is still recorded
   * as the imported payee either way.
   */
  payeeStrategy: "imported-payee" | "leave-unset";
  /**
   * Where a created transaction's Notes come from.
   *
   * `bank-notes` uses the statement's own memo field when it has one — the
   * closest thing to what notes are for. `imported-payee` copies the merchant
   * text in as well, which some people's rules read; it is a deliberate
   * duplicate of the imported payee, not the only place that text survives.
   */
  notesStrategy: "bank-notes" | "imported-payee" | "leave-unset";
  /**
   * Which transactions to mark cleared.
   *
   * Confirming that a transaction appeared on the statement is what a
   * reconciliation is for, so this is a real option rather than a detail. But
   * `reconciled` turns matched rows that needed no write into writes, which the
   * change count has to reflect honestly — hence a deliberate choice rather than
   * a default.
   */
  clearedTarget: "none" | "created" | "reconciled";
  /**
   * Attach the bank's merchant text to matched *existing* transactions.
   *
   * Mirrors what Actual's own import does on a match: keep the user's payee,
   * notes and category, and refresh `imported_payee` from the bank. It makes a
   * transaction more informative without undoing anything — but it is still a
   * write, so it is counted and shown separately from the changes the user
   * staged (RD-072 §2.4).
   */
  enrichImportedPayee: boolean;
};

export const DEFAULT_APPLY_CONFIG: ApplyConfig = {
  payeeStrategy: "imported-payee",
  notesStrategy: "bank-notes",
  clearedTarget: "none",
  enrichImportedPayee: true,
};

export type PlanInput = {
  sessionId: string;
  budgetSyncId: string;
  accountId: string;
  items: ReconciliationItem[];
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
  applyConfig?: ApplyConfig;
  /**
   * Operation ids an earlier run already wrote, from the session's own record.
   *
   * A reconciliation does not become un-applied because its decisions are still
   * on screen: without this the same staged changes are replanned every time,
   * and an applied session goes on offering to apply itself.
   */
  appliedOperationIds?: ReadonlySet<string>;
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
  const applyConfig = input.applyConfig ?? DEFAULT_APPLY_CONFIG;
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

        const enrichment = enrichmentFor(item, transaction, input, applyConfig);

        if (!hasStagedChanges(item.stagedChanges)) {
          if (item.disposition === "correct-amount") break;

          // Marking a matched transaction cleared is a change worth making even
          // when no field differs — but only where it would actually change
          // something. A row already cleared, or already reconciled in Actual,
          // needs no write, and pretending otherwise would inflate the count the
          // user is about to approve.
          const markCleared =
            applyConfig.clearedTarget === "reconciled" &&
            !transaction.cleared &&
            !item.guards.protectedReconciled;

          if (markCleared || enrichment !== null) {
            operations.push({
              ...updateOperationFor(item, transaction),
              ...(markCleared ? { cleared: true } : {}),
              ...(enrichment !== null ? { importedPayee: enrichment } : {}),
            });
            break;
          }

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

        operations.push({
          ...updateOperationFor(item, transaction),
          ...(applyConfig.clearedTarget === "reconciled" && !transaction.cleared
            ? { cleared: true }
            : {}),
          ...(enrichment !== null ? { importedPayee: enrichment } : {}),
        });
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

  // Filtered at the end rather than at each branch, so every operation is
  // built the same way and only then checked against what has already run.
  const applied = input.appliedOperationIds;
  const remaining = applied
    ? operations.filter((operation) => !applied.has(operation.id))
    : operations;

  return {
    operations: remaining,
    alreadyApplied: operations.length - remaining.length,
    noWriteMatches,
    unresolved,
    blocked,
  };
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
  const config = input.applyConfig ?? DEFAULT_APPLY_CONFIG;
  const importedPayee = row.importedPayee.trim() || null;
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
    // Bank provenance. Derived from the statement alone, never from the payee
    // or notes strategy: whatever the user does with the text, this is what the
    // bank called the transaction (RD-072 §2.2).
    importedPayee,
    // The payee candidate. A staged payee id always wins; leaving this null
    // hands the decision to Actual's rules, which run on create.
    payeeName:
      patch?.payeeId?.staged || config.payeeStrategy !== "imported-payee"
        ? null
        : importedPayee,
    // Left unset so Actual's rules decide it on the way in, which is where
    // categorising belongs.
    categoryId: null,
    // Shared with the transformation engine, so a rule that adds a tag to a new
    // transaction and the write that creates it agree on what its note is.
    notes: prospectiveTransaction({
      item,
      statementRow: row,
      transaction: undefined,
      applyConfig: config,
    }).notes,
    cleared: config.clearedTarget !== "none",
    marker: createMarker({
      budgetSyncId: input.budgetSyncId,
      accountId: input.accountId,
      sessionId: input.sessionId,
      fingerprint: row.fingerprint,
    }),
  };
}

/**
 * The bank text to attach to a matched existing transaction, or null for none.
 *
 * Null in every case where the write would achieve nothing or would not be
 * ours to make: the setting is off, the statement has no merchant text, Actual
 * already holds exactly that text, or the row is reconciled in Actual — which
 * Actual's own importer skips too, and which this feature has protected from
 * the start.
 */
function enrichmentFor(
  item: ReconciliationItem,
  transaction: ActualTransactionSnapshot,
  input: PlanInput,
  config: ApplyConfig
): string | null {
  if (!config.enrichImportedPayee) return null;
  if (item.guards.protectedReconciled) return null;

  const row = input.statementRows.get(item.statementRowIds[0] ?? "");
  const importedPayee = row?.importedPayee.trim();
  if (!importedPayee) return null;
  if ((transaction.importedPayee ?? "").trim() === importedPayee) return null;

  return importedPayee;
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
