import { ensureAutomationJobTypesRegistered } from "@/lib/automation/bootstrap";
import { reconcileJobTypes } from "@/lib/automation/engine";
import type { SqliteDatabase } from "@/lib/app-db/types";

/**
 * Bring the automation engine's view of sync flows up to date, right after the
 * flow that changed was written.
 *
 * Enrollment is *derived*: a flow is enrolled because its review policy says
 * `auto_sync_unattended`, not because anyone created an automation for it. That
 * derivation has to run somewhere, and running it only on the engine's tick
 * meant a flow saved as unattended did not appear on the Automations page until
 * the next tick came round - long enough for someone to conclude it had not
 * worked and change something else.
 *
 * Calling it here makes saving a flow the moment its automation appears (or
 * disappears), which is what the person doing the saving already believes
 * happened. The tick and the Automations read path still reconcile too; those
 * are now a safety net rather than the mechanism.
 *
 * Never throws: reconciliation is bookkeeping *about* the save, not part of it.
 * A flow the user successfully saved must not report failure because its
 * automation could not be worked out, so `reconcileJobTypes` swallowing and
 * logging per-type failures is exactly the behaviour wanted here.
 */
export async function syncAutomationsWithFlows(db: SqliteDatabase): Promise<void> {
  ensureAutomationJobTypesRegistered();
  await reconcileJobTypes(db);
}
