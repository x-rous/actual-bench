import type { SafetyPointOutcome, SafetyPointSettings } from "@/lib/backup/safetyPoint";
import { exportBrowserApiBudgetZip } from "@/lib/actual/browser/runtime";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { isBrowserApiConnection, type ConnectionInstance } from "@/store/connection";

/**
 * Asking for a recovery point before a risky change (RD-077 / PR-047f).
 *
 * Client side of the shared action. The important part is `shouldTakeRecoveryPoint`:
 * a rule about *which* changes are worth a full export, kept in one place so
 * every risky screen agrees. Renaming one payee does not warrant it; merging
 * forty does, and so does anything that deletes.
 */

export type RiskyChange = {
  /** Total staged items about to be written. */
  itemCount: number;
  /** Items that remove something, which is what makes a change hard to undo. */
  deleteCount?: number;
  /** Payee merges are irreversible in Actual, whatever their count. */
  mergeCount?: number;
};

/** Batches at or above this size are worth a copy on their own. */
export const RISKY_ITEM_THRESHOLD = 25;

export function shouldTakeRecoveryPoint(change: RiskyChange): boolean {
  if ((change.mergeCount ?? 0) > 0) return true;
  if ((change.deleteCount ?? 0) > 0) return true;
  return change.itemCount >= RISKY_ITEM_THRESHOLD;
}

export function describeRiskyChange(change: RiskyChange): string {
  const parts: string[] = [];
  if (change.mergeCount) parts.push(`${change.mergeCount} payee merge${change.mergeCount === 1 ? "" : "s"}`);
  if (change.deleteCount) parts.push(`${change.deleteCount} deletion${change.deleteCount === 1 ? "" : "s"}`);
  if (parts.length === 0) parts.push(`${change.itemCount} changes`);
  return `saving ${parts.join(" and ")}`;
}

/** The shape of one staged entity, as far as the risk rule cares. */
type StagedEntry = { isNew?: boolean; isUpdated?: boolean; isDeleted?: boolean };

/**
 * Count what a save is about to write.
 *
 * Takes a snapshot rather than being a store selector: a selector returning
 * this object would produce a new one on every call, the store's snapshot would
 * never compare equal, and React would re-render forever. Nothing renders these
 * numbers — only the decision to take a recovery point uses them — so they are
 * read once, at save time.
 */
export function countStagedRisk(snapshot: {
  slices: Record<string, StagedEntry>[];
  pendingPayeeMerges: unknown[];
}): RiskyChange {
  let itemCount = 0;
  let deleteCount = 0;
  for (const slice of snapshot.slices) {
    for (const entry of Object.values(slice)) {
      if (entry.isNew || entry.isUpdated || entry.isDeleted) itemCount += 1;
      if (entry.isDeleted) deleteCount += 1;
    }
  }
  return { itemCount, deleteCount, mergeCount: snapshot.pendingPayeeMerges.length };
}

/**
 * Ask for a recovery point of the budget being saved.
 *
 * The connection goes with the request so the server backs up *this* budget.
 * A Direct budget that is not enrolled can only be exported here: the server
 * answers `needs-archive`, and the budget is exported in this tab and sent.
 */
export async function takeRecoveryPoint(
  reason: string,
  connection: ConnectionInstance | null
): Promise<SafetyPointOutcome> {
  const fingerprint = connection ? connectionFingerprint(connection) : null;
  try {
    let outcome = await post(
      JSON.stringify({ reason, connectionFingerprint: fingerprint }),
      { "Content-Type": "application/json" }
    );
    if (outcome.status === "needs-archive" && connection && isBrowserApiConnection(connection)) {
      const form = new FormData();
      form.append("archive", new Blob([await exportBrowserApiBudgetZip(connection)], { type: "application/zip" }), "budget.zip");
      form.append("budgetId", connection.budgetSyncId);
      if (connection.label) form.append("budgetName", connection.label);
      form.append("reason", reason);
      if (fingerprint) form.append("connectionFingerprint", fingerprint);
      outcome = await post(form);
    }
    if (outcome.status === "needs-archive") {
      return { status: "failed", message: "This budget's recovery point has to be exported from a tab connected to it." };
    }
    return outcome;
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "Bench could not take a recovery point.",
    };
  }
}

async function post(body: BodyInit, headers?: Record<string, string>): Promise<SafetyPointOutcome> {
  const response = await fetch("/api/backups/safety-point", { method: "POST", headers, body });
  if (!response.ok) {
    return { status: "failed", message: `Bench could not take a recovery point (${response.status}).` };
  }
  return ((await response.json()) as { outcome: SafetyPointOutcome }).outcome;
}

export async function fetchSafetySettings(): Promise<SafetyPointSettings> {
  const response = await fetch("/api/backups/settings", { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return ((await response.json()) as { safetyPoints: SafetyPointSettings }).safetyPoints;
}

export async function patchSafetySettings(
  input: Partial<SafetyPointSettings>
): Promise<SafetyPointSettings> {
  const response = await fetch("/api/backups/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return ((await response.json()) as { safetyPoints: SafetyPointSettings }).safetyPoints;
}
