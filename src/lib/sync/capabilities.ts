import type { ConnectionInstance, ConnectionMode } from "@/store/connection";
import type { SyncCapabilityReport, SyncCapabilitySet } from "@/lib/app-db/types";

const NO_SYNC_CAPABILITIES: SyncCapabilitySet = {
  listBudgets: false,
  listAccounts: false,
  listTransactions: false,
  readSplitLines: false,
  createPayee: false,
  createTransaction: false,
  setImportedId: false,
  updateTransaction: false,
  deleteTransaction: false,
};

const CURRENT_DIRECT_CAPABILITIES: SyncCapabilitySet = {
  listBudgets: false,
  listAccounts: true,
  listTransactions: true,
  readSplitLines: true,
  createPayee: true,
  createTransaction: false,
  setImportedId: false,
  updateTransaction: false,
  deleteTransaction: false,
};

export type SyncCapabilityKey = keyof SyncCapabilitySet;

export function getBudgetFileSyncCapabilities(
  connection: Pick<ConnectionInstance, "mode"> | { mode: ConnectionMode }
): SyncCapabilityReport {
  if (connection.mode !== "browser-api") {
    return {
      mode: connection.mode,
      supported: false,
      reason: "Budget File Sync MVP supports Direct mode connections only.",
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
