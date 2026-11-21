import type { BackupPolicy } from "@/lib/app-db/backupRepository";
import type { SqliteDatabase, SyncCredentialMeta } from "@/lib/app-db/types";
import { listSyncCredentialMeta } from "@/lib/credentials/unattendedCredentials";

/**
 * The budget a rule backs up, by its sync id, or `null` when Bench cannot
 * tell (a settings-only rule, or a rule with no enrolment and no copies yet).
 *
 * The enrolment of the rule's connection says it directly. A Direct rule
 * that is not enrolled is fixed to its budget by its first copy, because a
 * rule's source cannot change once it has taken one.
 *
 * Used so a copy of one budget cannot count for a rule that backs up another:
 * attached by hand, a copy of budget B made budget A's rule report protected.
 */
export function ruleBudgetId(
  db: SqliteDatabase,
  policy: BackupPolicy,
  enrolled: SyncCredentialMeta[] = listSyncCredentialMeta(db)
): string | null {
  if (policy.contents === "app-db") return null;
  const fingerprint = policy.sourceRef.data.connectionFingerprint;
  const meta = enrolled.find((entry) => entry.connectionFingerprint === fingerprint);
  if (meta?.budgetSyncId) return meta.budgetSyncId;
  const first = db
    .prepare(
      `SELECT source_budget_id FROM backup_artifacts
        WHERE policy_id = ? AND kind = 'budget' AND source_budget_id IS NOT NULL
        ORDER BY created_at ASC LIMIT 1`
    )
    .get<{ source_budget_id: string }>(policy.id);
  return first?.source_budget_id ?? null;
}
