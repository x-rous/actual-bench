import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { getBackupDestination, listBackupDestinations } from "@/lib/app-db/backupRepository";
import { discoverBackups, type DiscoveryResult } from "@/lib/backup/discover";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Rebuild the inventory from the manifests in a destination.
 *
 * For the case this whole design anticipates: the server died, the volume was
 * recreated, Bench was restored onto a fresh machine — and the bucket is still
 * full of backups. Discovery adds; it never overwrites what Bench already knows
 * and never deletes.
 */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request).catch(() => ({}))) as { destinationId?: string };
    const db = getAppDb();

    const destinations = body?.destinationId
      ? [getBackupDestination(db, body.destinationId)].filter((entry) => entry !== null)
      : listBackupDestinations(db).filter((destination) => destination.enabled);

    if (destinations.length === 0) {
      return NextResponse.json({ error: "There is no destination to scan." }, { status: 404 });
    }

    const results: DiscoveryResult[] = [];
    for (const destination of destinations) {
      try {
        results.push(await discoverBackups(db, destination));
      } catch (error) {
        results.push({
          destinationId: destination.id,
          destinationName: destination.name,
          scanned: 0,
          imported: 0,
          alreadyKnown: 0,
          unreadable: 0,
          notes: [error instanceof Error ? error.message : String(error)],
        });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
