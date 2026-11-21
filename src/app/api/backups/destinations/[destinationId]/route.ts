import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  deleteBackupDestination,
  destinationHoldsCopies,
  getBackupDestination,
  listBackupPolicies,
  listDestinationLocations,
  updateBackupDestination,
  type BackupDestination,
} from "@/lib/app-db/backupRepository";
import { readLocalConfig } from "@/lib/backup/destinations/local";
import { readS3Config } from "@/lib/backup/destinations";
import { deleteBackupCredential, upsertBackupCredential } from "@/lib/credentials/backupSecrets";

type RouteContext = { params: Promise<{ destinationId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { destinationId } = await context.params;
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Destination payload must be an object" }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;
    const credentials = payload.credentials as
      | { accessKeyId?: string; secretAccessKey?: string; sessionToken?: string }
      | undefined;
    delete payload.credentials;

    const db = getAppDb();
    // Nothing is stored for a destination that does not exist: its id names
    // where the secret goes, and it comes from the URL.
    const existing = getBackupDestination(db, destinationId);
    if (!existing) {
      return NextResponse.json({ error: "Destination not found" }, { status: 404 });
    }

    /*
     * Where a destination points is fixed once it holds copies.
     *
     * Every copy is recorded by its key inside this destination. Changing the
     * folder, bucket or prefix silently re-pointed all of them at a place they
     * are not, and the next weekly check called every one of them missing.
     */
    if (payload.config !== undefined && destinationHoldsCopies(db, destinationId)) {
      const next = { ...existing, config: payload.config as BackupDestination["config"] };
      if (locationOf(existing) !== locationOf(next)) {
        return NextResponse.json(
          {
            error:
              "This destination already holds backups, so where it points cannot change. Add a new destination for the new location; the copies here stay where they are.",
          },
          { status: 409 }
        );
      }
    }
    if (credentials?.accessKeyId && credentials?.secretAccessKey) {
      upsertBackupCredential(db, {
        ref: destinationId,
        kind: "s3",
        secret: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
        },
      });
      payload.credentialRef = destinationId;
    }

    const destination = updateBackupDestination(db, destinationId, payload);
    if (!destination) return NextResponse.json({ error: "Destination not found" }, { status: 404 });
    return NextResponse.json({ destination });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/** Where a destination's copies live, normalised, for telling a move from an edit. */
function locationOf(destination: BackupDestination): string {
  try {
    if (destination.kind === "local") return `local:${readLocalConfig(destination).path}`;
    const config = readS3Config(destination);
    return `s3:${config.endpoint ?? ""}|${config.bucket}|${config.prefix}|${config.forcePathStyle}`;
  } catch {
    return "invalid";
  }
}

/**
 * Removing a destination removes Bench's ability to reach it — never the copies
 * inside it. Those are still real files, and deleting someone's backups because
 * they tidied up a configuration entry would be indefensible; the response says
 * what was left behind so the UI can say it too.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { destinationId } = await context.params;
    const db = getAppDb();

    const destination = getBackupDestination(db, destinationId);
    if (!destination) return NextResponse.json({ error: "Destination not found" }, { status: 404 });

    const inUse = listBackupPolicies(db).filter((policy) => policy.destinationIds.includes(destinationId));
    if (inUse.length > 0) {
      return NextResponse.json(
        {
          error: `${inUse.map((policy) => `"${policy.name}"`).join(", ")} still ${
            inUse.length === 1 ? "writes" : "write"
          } here. Remove it from ${inUse.length === 1 ? "that rule" : "those rules"} first.`,
        },
        { status: 409 }
      );
    }

    const orphanedCopies = listDestinationLocations(db, destinationId, { limit: "all" }).filter(
      (location) => location.status === "stored"
    ).length;

    deleteBackupDestination(db, destinationId);
    deleteBackupCredential(db, destinationId);

    return NextResponse.json({ deleted: true, orphanedCopies });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
