/**
 * The Bank Sync job type's identifier, alone in its own module.
 *
 * Same reason as `budgetFileSyncType`: the job type and anything that needs to
 * name it would otherwise import each other, and such cycles work under Jest's
 * CommonJS while failing under a bundler's module initialization order.
 */
export const BANK_SYNC_JOB_TYPE = "bank-sync";
