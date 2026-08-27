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
import { buildBackupReadiness } from "@/lib/backup/readiness";
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
      policies: listBackupPolicies(db),
      artifacts,
      // Which budgets can be backed up unattended, and why some cannot.
      sources: listSyncCredentialMeta(db).map((credential) => ({
        connectionFingerprint: credential.connectionFingerprint,
        label: credential.label || credential.baseUrl,
        baseUrl: credential.baseUrl,
        budgetSyncId: credential.budgetSyncId,
      })),
      vaultEnabled: vaultEnabled(),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
