/**
 * The Budget File Sync job type's identifier, alone in its own module.
 *
 * The job type needs its enrolment sweep and the sweep needs the identifier,
 * which is a cycle if the constant lives with either of them. Cycles like that
 * happen to work under Jest's CommonJS and can fail under a bundler's module
 * initialization order, so the shared value sits where neither side has to
 * import the other.
 */
export const BUDGET_FILE_SYNC_JOB_TYPE = "budget-file-sync";
