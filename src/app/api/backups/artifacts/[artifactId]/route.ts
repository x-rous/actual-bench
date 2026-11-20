import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  deleteBackupArtifact,
  getBackupArtifact,
  getBackupDestination,
  getBackupPolicy,
  listArtifactLocations,
  recordArtifactLocation,
  setArtifactPinned,
  setArtifactPolicy,
} from "@/lib/app-db/backupRepository";
import { openDestination } from "@/lib/backup/destinations";
import { acceptPlausibilityFindings } from "@/lib/backup/verificationRecord";
import { manifestKeyFor } from "@/lib/backup/manifest";
import { collectUnusedPassphrases } from "@/lib/backup/passphrases";

type RouteContext = { params: Promise<{ artifactId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Change one backup: pin it, accept that it is smaller than the last good copy,
 * or give a copy that has no rule (its rule was deleted, or it was found in a
 * destination) to a rule, whose retention then looks after it.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { artifactId } = await context.params;
    const body = (await readJsonBody(request)) as {
      pinned?: boolean;
      acceptChange?: boolean;
      policyId?: string;
    };
    const db = getAppDb();
    const existing = getBackupArtifact(db, artifactId);
    if (!existing) return NextResponse.json({ error: "Backup not found" }, { status: 404 });

    if (body?.acceptChange === true) {
      if (!acceptPlausibilityFindings(db, existing, new Date().toISOString())) {
        return NextResponse.json(
          { error: "This copy has nothing to accept: it is not flagged as smaller than the previous one, or it could not be read." },
          { status: 409 }
        );
      }
      return NextResponse.json({ artifact: getBackupArtifact(db, artifactId) });
    }

    if (typeof body?.policyId === "string") {
      if (existing.policyId && getBackupPolicy(db, existing.policyId)) {
        return NextResponse.json({ error: "This copy already belongs to a rule." }, { status: 409 });
      }
      const policy = getBackupPolicy(db, body.policyId);
      if (!policy) return NextResponse.json({ error: "Backup rule not found" }, { status: 404 });
      const holdsKind = policy.contents === "both" || policy.contents === existing.kind;
      if (!holdsKind) {
        return NextResponse.json(
          { error: `"${policy.name}" does not back up ${existing.kind === "budget" ? "a budget" : "Bench's settings"}.` },
          { status: 400 }
        );
      }
      return NextResponse.json({ artifact: setArtifactPolicy(db, artifactId, policy.id) });
    }

    if (typeof body?.pinned !== "boolean") {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }
    const artifact = setArtifactPinned(db, artifactId, body.pinned);
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
        // Checked first: deleting through an unmounted folder "succeeds" on
        // files that are not there, and the real copy would be forgotten.
        const adapter = await openDestination(db, destination);
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
