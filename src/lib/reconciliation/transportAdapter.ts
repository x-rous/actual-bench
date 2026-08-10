/**
 * Adapter from the reconciliation port to the shared transport (RD-071 D1).
 *
 * The only file in the reconciliation engine that knows the Budget File Sync
 * primitives exist. Everything else depends on `ports.ts`.
 *
 * Two boundary responsibilities live here:
 *
 * 1. **Normalising the optional read fields.** `importedPayee`, `transferId`
 *    and `scheduleId` are optional on the transport type so the sync engine and
 *    its fixtures are unaffected. Reconciliation needs a definite `string |
 *    null`, and it must distinguish "this transport does not report transfers"
 *    from "this row is not a transfer" — see `transferStatusOf`.
 * 2. **Excluding split children.** The statement's financial counterpart is the
 *    split *parent*, which carries the posted amount (RD-071 D12).
 */

import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import type {
  AppliedSnapshot,
  CreatedTransaction,
  LoadedCandidateWindow,
  LoadTransactionsInput,
  ReconciliationTransport,
  TransactionCreateDraft,
  TransactionUpdateInput,
} from "./ports";
import type { ActualTransactionSnapshot } from "./types";

/**
 * Whether this transport reports transfer membership at all.
 *
 * A transport that never populates `transferId` is indistinguishable, row by
 * row, from an account with no transfers. Callers must therefore ask this
 * question once per snapshot rather than inferring it per row: when the field is
 * absent everywhere, every row's transfer status is `unknown`, and the
 * guardrail takes its conservative branch (RD-071 D13).
 */
export function transportReportsTransfers(rows: SyncSourceTransaction[]): boolean {
  return rows.some((row) => row.transferId !== undefined);
}

export function toActualSnapshot(
  row: SyncSourceTransaction,
  options: { transfersReported: boolean }
): ActualTransactionSnapshot {
  return {
    id: row.id,
    accountId: row.accountId,
    date: row.date,
    amount: row.amount,
    payeeId: row.payeeId,
    payeeName: row.payeeName,
    importedPayee: row.importedPayee ?? null,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    notes: row.notes,
    cleared: row.cleared,
    reconciled: row.reconciled,
    importedId: row.importedId,
    // Preserved as null when unreported; `guards.transfer` carries the
    // three-valued answer that the delete guardrail actually reads.
    transferId: options.transfersReported ? row.transferId ?? null : null,
    scheduleId: row.scheduleId ?? null,
    isParent: row.isParent,
    isChild: row.isChild,
    parentId: row.parentId,
    splitLines: row.splitLines.map((line) => ({
      id: line.id,
      amount: line.amount,
      payeeName: line.payeeName,
      categoryId: line.categoryId,
      categoryName: line.categoryName,
      notes: line.notes,
    })),
  };
}

/** The three-valued transfer status the delete/payee guardrails read. */
export function transferStatusOf(
  snapshot: ActualTransactionSnapshot,
  transfersReported: boolean
): "yes" | "no" | "unknown" {
  if (!transfersReported) return "unknown";
  return snapshot.transferId ? "yes" : "no";
}

function appliedFrom(
  applied: { amount: number; date: string; categoryId: string | null; payeeId: string | null; notes: string | null } | null
): AppliedSnapshot | null {
  if (!applied) return null;
  return {
    amount: applied.amount,
    date: applied.date,
    categoryId: applied.categoryId,
    payeeId: applied.payeeId,
    notes: applied.notes,
  };
}

export function createReconciliationTransport(
  transport: ActualBenchTransport
): ReconciliationTransport {
  return {
    async loadTransactions(input: LoadTransactionsInput): Promise<LoadedCandidateWindow> {
      const rows = await transport.listTransactionsForSync({
        accountId: input.accountId,
        startDate: input.startDate,
        endDate: input.endDate,
      });
      const transfersReported = transportReportsTransfers(rows);
      return {
        transfersReported,
        transactions: rows
          .filter((row) => !row.isChild)
          .map((row) => toActualSnapshot(row, { transfersReported })),
      };
    },

    async readTransaction(input) {
      const applied = await transport.readTargetTransactionForSync(input);
      if (!applied) return null;
      // The single-row read returns only the syncable fields, so the caller gets
      // a partial snapshot: enough to detect drift on the fields Apply writes.
      return {
        id: input.transactionId,
        accountId: input.accountId,
        date: applied.date,
        amount: applied.amount,
        payeeId: applied.payeeId,
        payeeName: null,
        importedPayee: null,
        categoryId: applied.categoryId,
        categoryName: null,
        notes: applied.notes,
        cleared: applied.cleared,
        // Not exposed by the single-row read; a caller needing certainty about
        // protection re-loads the window rather than trusting this.
        reconciled: false,
        importedId: null,
        transferId: null,
        scheduleId: null,
        isParent: false,
        isChild: false,
        parentId: null,
        splitLines: [],
      };
    },

    async readExistingMarkers(input) {
      const lookup = await transport.getTargetLookupForSync({
        accountId: input.accountId,
        startDate: input.startDate,
        endDate: input.endDate,
      });
      return new Set(lookup.importedIdIndex.keys());
    },

    async createTransactions(inputs: TransactionCreateDraft[]): Promise<CreatedTransaction[]> {
      const result = await transport.createTransactionsForSync(
        inputs.map((input) => ({
          accountId: input.accountId,
          date: input.date,
          amount: input.amount,
          payeeId: input.payeeId,
          payeeName: input.payeeName,
          categoryId: input.categoryId,
          notes: input.notes,
          cleared: input.cleared,
          importedId: input.importedId,
        }))
      );
      return result.created.map((created) => ({
        requestIndex: created.requestIndex,
        transactionId: created.transactionId,
        importedId: created.importedId,
      }));
    },

    async updateTransaction(input: TransactionUpdateInput) {
      // Nothing here reads the persisted snapshot, and asking for it costs a
      // range query per update.
      return appliedFrom(
        await transport.updateTransactionForSync({ ...input, returnApplied: false })
      );
    },

    async deleteTransaction(input) {
      await transport.deleteTransactionForSync(input);
    },

    resolvePayee(input) {
      return transport.createOrResolvePayee(input);
    },
  };
}
