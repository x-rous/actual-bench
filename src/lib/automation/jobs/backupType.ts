/**
 * The backup job types' identifiers, alone in their own module.
 *
 * Same reason as `budgetFileSyncType` and `bankSyncType`: the job type and
 * anything that needs to name it would otherwise import each other, and such
 * cycles work under Jest's CommonJS while failing under a bundler's module
 * initialization order.
 */
export const BACKUP_JOB_TYPE = "backup";
export const BACKUP_SCRUB_JOB_TYPE = "backup-scrub";
