/**
 * The reconciliation engine's transport port (RD-071 §5.1, D1).
 *
 * The engine never imports `@/lib/actual` directly. It talks to this narrow,
 * reconciliation-named interface, and one adapter maps it onto the existing
 * Budget File Sync primitives — which already implement transaction read,
 * create, update, delete, single-row re-read, and payee resolution on **both**
 * transports.
 *
 * Reusing those primitives is deliberate: AGENTS.md forbids a second
 * transaction-write subsystem. The `*ForSync` names are wider than their label;
 * renaming them touches the whole sync engine and belongs to its own refactor,
 * so the indirection lives here instead and a later rename is a one-file change.
 */

import type {
  ActualTransactionSnapshot,
  MinorUnitAmount,
} from "./types";

export type LoadTransactionsInput = {
  accountId: string;
  /** Inclusive ISO `YYYY-MM-DD`. */
  startDate: string;
  endDate: string;
};

export type TransactionCreateDraft = {
  accountId: string;
  date: string;
  amount: MinorUnitAmount;
  payeeId?: string | null;
  payeeName?: string | null;
  categoryId?: string | null;
  notes?: string | null;
  /**
   * Deterministic marker derived from the session and statement row, so a retry
   * after a partial Apply can never create the same transaction twice
   * (RD-071 D14). Opaque equality key — never parsed.
   */
  importedId?: string | null;
};

export type TransactionUpdateInput = {
  transactionId: string;
  accountId: string;
  date: string;
  amount: MinorUnitAmount;
  payeeId?: string | null;
  payeeName?: string | null;
  categoryId?: string | null;
  notes?: string | null;
};

export type CreatedTransaction = {
  /** Index into the input array this result corresponds to. */
  requestIndex: number;
  transactionId: string | null;
  importedId: string | null;
};

export type AppliedSnapshot = {
  amount: MinorUnitAmount;
  date: string;
  categoryId: string | null;
  payeeId: string | null;
  notes: string | null;
};

export type ReconciliationTransport = {
  /** Load the candidate window. Split children are excluded. */
  loadTransactions(input: LoadTransactionsInput): Promise<ActualTransactionSnapshot[]>;
  /**
   * Re-read one transaction, or null when it no longer exists.
   *
   * This is the drift primitive: before Apply, every targeted row is re-read and
   * compared against the session snapshot so a note the user edited elsewhere is
   * never silently overwritten (feature spec §41/§42).
   */
  readTransaction(input: {
    accountId: string;
    transactionId: string;
    date?: string;
  }): Promise<ActualTransactionSnapshot | null>;
  createTransactions(inputs: TransactionCreateDraft[]): Promise<CreatedTransaction[]>;
  updateTransaction(input: TransactionUpdateInput): Promise<AppliedSnapshot | null>;
  deleteTransaction(input: { transactionId: string }): Promise<void>;
  resolvePayee(input: { name: string }): Promise<{ id: string; name: string; created: boolean }>;
};
