import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import {
  listArtifactLocations,
  listBackupArtifacts,
  listBackupDestinations,
  listBackupPolicies,
} from "@/lib/app-db/backupRepository";
import { listSyncCredentialMeta } from "@/lib/app-db/syncCredentialRepository";
import { listAutomations } from "@/lib/app-db/automationRepository";
import { listAutomationRuns } from "@/lib/app-db/automationRunRepository";
import { buildAutomationHealth } from "@/lib/automation/health";
import { isAutomationRunning } from "@/lib/automation/engine";
import { BACKUP_JOB_TYPE } from "@/lib/automation/jobs/backupType";
import { buildBackupReadiness } from "@/lib/backup/readiness";
import { listHeldPassphrases } from "@/lib/backup/passphrases";
import { vaultEnabled } from "@/lib/sync/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Everything the Recovery Center needs, in one request.
 *
 * Deliberately one call rather than five: the page is a single answer to "what
 * would I get back if I needed it", and assembling that from separate requests
 * would let it render half-answered — a readiness line contradicting the
 * inventory below it for a second is worse than waiting.
 */
export async function GET() {
  try {
    const db = getAppDb();

    const destinations = listBackupDestinations(db);

    // A rule's schedule is carried out by an automation, and the two can
    // disagree: the engine auto-pauses after repeated failures, and a person
    // can pause it by hand. Showing the rule as "enabled" while nothing runs
    // would be the page telling a comfortable lie, so the automation's real
    // state travels with each rule.
    const health = new Map(
      buildAutomationHealth(db).automations.map((entry) => [entry.id, entry])
    );
    const automationByPolicy = new Map(
      listAutomations(db, { type: BACKUP_JOB_TYPE })
        .filter((automation) => typeof automation.config.data.policyId === "string")
        .map((automation) => {
          const [lastRun] = listAutomationRuns(db, { automationId: automation.id, limit: 1 });
          return [
            automation.config.data.policyId as string,
            {
              id: automation.id,
              enabled: automation.enabled,
              running: isAutomationRunning(automation),
              autoPausedAt: automation.autoPausedAt,
              autoPauseReason: automation.autoPauseReason,
              lastRunAt: automation.lastRunAt,
              nextRunAt: automation.nextRunAt,
              status: health.get(automation.id)?.status ?? "idle",
              statusSummary: health.get(automation.id)?.summary ?? "",
              lastRunMessage: lastRun?.rollup?.message ?? null,
            },
          ] as const;
        })
    );
    const artifacts = listBackupArtifacts(db, { limit: 200 }).map((artifact) => ({
      ...artifact,
      locations: listArtifactLocations(db, artifact.id).map((location) => ({
        ...location,
        destinationName:
          destinations.find((destination) => destination.id === location.destinationId)?.name ?? null,
      })),
    }));

    return NextResponse.json({
      readiness: buildBackupReadiness(db),
      destinations,
      policies: listBackupPolicies(db).map((policy) => ({
        ...policy,
        automation: automationByPolicy.get(policy.id) ?? null,
      })),
      artifacts,
      // Which budgets can be backed up unattended, and why some cannot.
      sources: listSyncCredentialMeta(db).map((credential) => ({
        connectionFingerprint: credential.connectionFingerprint,
        label: credential.label || credential.baseUrl,
        baseUrl: credential.baseUrl,
        budgetSyncId: credential.budgetSyncId,
      })),
      // Secrets Bench is holding on behalf of backups that still need them —
      // never the secret itself, only what depends on it.
      heldPassphrases: listHeldPassphrases(db),
      vaultEnabled: vaultEnabled(),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
