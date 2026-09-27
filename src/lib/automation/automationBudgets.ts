import { getBackupPolicy } from "@/lib/app-db/backupRepository";
import { getSyncFlow } from "@/lib/app-db/syncFlowRepository";
import type { AutomationDefinition, SqliteDatabase, SyncCredentialMeta } from "@/lib/app-db/types";
import { listSyncCredentialMeta } from "@/lib/credentials/unattendedCredentials";
import { BACKUP_JOB_TYPE } from "./jobs/backupType";
import { BANK_SYNC_JOB_TYPE } from "./jobs/bankSyncType";
import { BUDGET_FILE_SYNC_JOB_TYPE } from "./jobs/budgetFileSyncType";

/**
 * The budgets an automation works on, by name, for the Automations table:
 * a bank sync's or backup's one budget, a Budget File Sync's source then
 * target. `null` marks a budget that can no longer be found (its enrolment was
 * removed), which the run will fail on too. An empty list means the
 * automation isn't about particular budgets (verifying stored backups).
 *
 * Reads only non-secret metadata. `enrolments` is passed in so a whole list is
 * resolved with one read.
 */
export function automationBudgets(
  db: SqliteDatabase,
  automation: AutomationDefinition,
  enrolments: SyncCredentialMeta[] = listSyncCredentialMeta(db)
): (string | null)[] {
  const nameOf = (fingerprint: unknown): string | null => {
    if (typeof fingerprint !== "string") return null;
    const enrolment = enrolments.find((entry) => entry.connectionFingerprint === fingerprint);
    return enrolment ? enrolment.label || enrolment.budgetSyncId : null;
  };

  switch (automation.type) {
    case BANK_SYNC_JOB_TYPE:
      return [nameOf(automation.config.data.connectionFingerprint ?? automation.credentialRef)];
    case BACKUP_JOB_TYPE: {
      const policyId = automation.targetRef.data.policyId;
      const policy = typeof policyId === "string" ? getBackupPolicy(db, policyId) : null;
      return [policy ? nameOf(policy.sourceRef.data.connectionFingerprint) : null];
    }
    case BUDGET_FILE_SYNC_JOB_TYPE: {
      const flowId = automation.targetRef.data.flowId;
      const flow = typeof flowId === "string" ? getSyncFlow(db, flowId) : null;
      if (!flow) return [null, null];
      // A server-run sync needs each side's enrolment: without it the stored
      // name is no longer a budget the run can reach. One run in the browser
      // uses the tab's own connections, so its stored name stands.
      const needsEnrolment = automation.executionMode === "server";
      const side = (ref: Record<string, unknown>) => {
        const enrolled = nameOf(ref.connectionFingerprint);
        if (needsEnrolment && typeof ref.connectionFingerprint === "string" && enrolled === null) return null;
        return (typeof ref.budgetName === "string" && ref.budgetName) || enrolled;
      };
      return [side(flow.sourceRef.data ?? {}), side(flow.targetRef.data ?? {})];
    }
    default:
      return [];
  }
}
