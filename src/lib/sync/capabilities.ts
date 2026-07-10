import type { ConnectionInstance, ConnectionMode } from "@/store/connection";
import type { SyncCapabilityReport, SyncCapabilitySet } from "@/lib/app-db/types";

const NO_SYNC_CAPABILITIES: SyncCapabilitySet = {
  listBudgets: false,
  listAccounts: false,
  listTransactions: false,
  readSplitLines: false,
  createPayee: false,
  createTransaction: false,
  createTransactionWithImportedId: false,
  createTransactionWithNotesMarker: false,
  createSplitLinesAsSeparateTransactions: false,
  supportsMultiRuntimeBudgetAccess: false,
  updateTransaction: false,
  deleteTransaction: false,
};

/**
 * Direct-mode capabilities proven by the PR-019 Slice 1 capability spike.
 *
 * Only operations verified against the `@actual-app/api` browser transport are
 * marked `true`. See `agents/pr-specs/notes/pr-019-slice1-direct-capability-spike.md`
 * for the supporting evidence (create path, imported_id marker, split handling,
 * and runtime-model findings).
 */
const CURRENT_DIRECT_CAPABILITIES: SyncCapabilitySet = {
  // Budget listing is not exercised by the sync transport layer yet.
  listBudgets: false,
  listAccounts: true,
  listTransactions: true,
  readSplitLines: true,
  createPayee: true,
  createTransaction: true,
  createTransactionWithImportedId: true,
  createTransactionWithNotesMarker: true,
  createSplitLinesAsSeparateTransactions: true,
  // Actual's browser API keeps a single process-global budget open at a time,
  // so two budgets cannot be held open concurrently in one JS realm. Pattern B
  // (isolated worker per budget) is not proven, so cross-budget sync uses
  // sequential Pattern A switching for the MVP.
  supportsMultiRuntimeBudgetAccess: false,
  // MVP is create-only; no target updates/deletes.
  updateTransaction: false,
  deleteTransaction: false,
};

/**
 * HTTP-API Server mode capabilities (RD-060).
 *
 * Phase 1 enables master-data (payee/category) sync only: the HTTP transport
 * already implements `getPayees`/`createPayee`/`getCategoryGroups`/
 * `createCategory`/`createCategoryGroup`. Transaction sync stays off
 * (`listTransactions`/`createTransactionWithImportedId` false) until the
 * transaction endpoints are implemented and the `imported_id` round-trip is
 * verified (Phase 2). Two HTTP connections are independent servers, so budgets
 * can be read concurrently without single-runtime switching.
 */
const HTTP_ENTITY_CAPABILITIES: SyncCapabilitySet = {
  listBudgets: false,
  listAccounts: true,
  listTransactions: false,
  readSplitLines: false,
  createPayee: true,
  createTransaction: false,
  createTransactionWithImportedId: false,
  createTransactionWithNotesMarker: false,
  createSplitLinesAsSeparateTransactions: false,
  supportsMultiRuntimeBudgetAccess: true,
  updateTransaction: false,
  deleteTransaction: false,
};

export type SyncCapabilityKey = keyof SyncCapabilitySet;

export function getBudgetFileSyncCapabilities(
  connection: Pick<ConnectionInstance, "mode"> | { mode: ConnectionMode }
): SyncCapabilityReport {
  if (connection.mode === "http-api") {
    return {
      mode: "http-api",
      supported: true,
      reason: null,
      capabilities: { ...HTTP_ENTITY_CAPABILITIES },
    };
  }
  if (connection.mode !== "browser-api") {
    return {
      mode: connection.mode,
      supported: false,
      reason: "Budget File Sync supports Direct and HTTP API connections.",
      capabilities: { ...NO_SYNC_CAPABILITIES },
    };
  }

  return {
    mode: "browser-api",
    supported: true,
    reason: null,
    capabilities: { ...CURRENT_DIRECT_CAPABILITIES },
  };
}

export function missingSyncCapabilities(
  report: SyncCapabilityReport,
  required: SyncCapabilityKey[]
): SyncCapabilityKey[] {
  return required.filter((key) => !report.capabilities[key]);
}

export function hasSyncCapabilities(
  report: SyncCapabilityReport,
  required: SyncCapabilityKey[]
): boolean {
  return missingSyncCapabilities(report, required).length === 0;
}
