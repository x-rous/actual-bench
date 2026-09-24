/**
 * Next.js server startup hook. Boots the in-process automation engine
 * (RD-079 / PR-043c) once, in the Node runtime only (never edge / build).
 *
 * The engine replaces RD-058's sync-specific scheduler: Budget File Sync is now
 * a registered job type rather than the only thing a timer knows how to run.
 * Registration and the one-time flow migration both happen before the first
 * tick, so an upgraded install keeps syncing on its existing schedule with no
 * user action.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const [
    { startAutomationEngine },
    { ensureAutomationJobTypesRegistered },
    { migrateSyncFlowsToAutomations },
    { getAppDb },
    { logger },
    { upgradeLegacyUnattendedCredentials },
  ] = await Promise.all([
    import("@/lib/automation/runtime"),
    import("@/lib/automation/bootstrap"),
    import("@/lib/automation/jobs/budgetFileSyncMigration"),
    import("@/lib/app-db/connection"),
    import("@/lib/logger"),
    import("@/lib/credentials/unattendedCredentials"),
  ]);

  try {
    // Unattended secrets from before schema v35 were kept whole, because the
    // migration runs without the vault key. Split them now that it may be
    // here; each one is also split on first use, so this only saves a delay.
    upgradeLegacyUnattendedCredentials(getAppDb());
  } catch (error) {
    logger.warn(
      `[credentials] could not upgrade unattended credentials: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Every job type, not just the first one. Registering only Budget File Sync
  // here meant the engine's own tick knew nothing about bank sync or backups:
  // it would find their automations due, fail to resolve a type, and auto-pause
  // them with "No job type registered". Whether that happened at all depended
  // on whether an API route had run in the same module instance first and
  // populated the registry as a side effect - which is why it looked
  // intermittent.
  ensureAutomationJobTypesRegistered();

  try {
    migrateSyncFlowsToAutomations(getAppDb());
  } catch (error) {
    // A migration failure must not stop the server booting; the automations
    // simply are not created yet, and the reason is in the log.
    logger.warn(
      `[automation] could not migrate sync flows: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  startAutomationEngine();
}
