import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  deleteBackupArtifact,
  getBackupArtifact,
  getBackupDestination,
  listArtifactLocations,
  recordArtifactLocation,
  setArtifactPinned,
} from "@/lib/app-db/backupRepository";
import { createDestinationAdapter } from "@/lib/backup/destinations";
import { manifestKeyFor } from "@/lib/backup/manifest";
import { collectUnusedPassphrases } from "@/lib/backup/passphrases";

type RouteContext = { params: Promise<{ artifactId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { artifactId } = await context.params;
    const body = (await readJsonBody(request)) as { pinned?: boolean };
    if (typeof body?.pinned !== "boolean") {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }

    const artifact = setArtifactPinned(getAppDb(), artifactId, body.pinned);
    if (!artifact) return NextResponse.json({ error: "Backup not found" }, { status: 404 });
    return NextResponse.json({ artifact });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/**
 * Delete one backup, everywhere it is stored.
 *
 * The user asked for this one specifically, so a pin does not block it — a pin
 * protects a backup from *retention*, not from its owner. What does block it is
 * a copy Bench cannot delete: the row stays, so the file does not become an
 * orphan nobody has a record of.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { artifactId } = await context.params;
    const db = getAppDb();

    const artifact = getBackupArtifact(db, artifactId);
    if (!artifact) return NextResponse.json({ error: "Backup not found" }, { status: 404 });

    const failures: string[] = [];
    for (const location of listArtifactLocations(db, artifactId)) {
      if (location.status !== "stored" || !location.destinationId) continue;
      const destination = getBackupDestination(db, location.destinationId);
      if (!destination) continue;

      try {
        const adapter = createDestinationAdapter(db, destination);
        await adapter.remove(location.objectKey);
        await adapter.remove(manifestKeyFor(location.objectKey));
        recordArtifactLocation(db, {
          artifactId,
          destinationId: destination.id,
          objectKey: location.objectKey,
          status: "deleted",
        });
      } catch (error) {
        failures.push(
          `${destination.name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (failures.length > 0) {
      return NextResponse.json(
        {
          error: `Bench could not delete every copy, so it kept its record of this backup: ${failures.join("; ")}`,
        },
        { status: 502 }
      );
    }

    deleteBackupArtifact(db, artifactId);
    collectUnusedPassphrases(db);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
