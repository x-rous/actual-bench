import { registerBankSyncJobType } from "./jobs/bankSync";
import { registerBackupJobType } from "./jobs/backup";
import { registerBackupScrubJobType } from "./jobs/backupScrub";
import { registerBudgetFileSyncJobType } from "./jobs/budgetFileSync";

/**
 * Register every built-in job type.
 *
 * Next re-evaluates route modules independently of the server boot context, so
 * a route handler may run in a module instance where `instrumentation.ts` never
 * executed — the same lesson RD-058 learned when its scheduler snapshot had to
 * go through the database to reach the health route. Every entry point that
 * resolves a job type calls this first; registration is idempotent.
 */
export function ensureAutomationJobTypesRegistered(): void {
  registerBudgetFileSyncJobType();
  registerBankSyncJobType();
  registerBackupJobType();
  registerBackupScrubJobType();
}
