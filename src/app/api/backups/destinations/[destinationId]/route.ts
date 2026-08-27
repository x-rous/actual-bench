import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  deleteBackupDestination,
  getBackupDestination,
  listBackupPolicies,
  listDestinationLocations,
  updateBackupDestination,
} from "@/lib/app-db/backupRepository";
import { deleteBackupCredential, upsertBackupCredential } from "@/lib/app-db/backupCredentialRepository";

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

    const orphanedCopies = listDestinationLocations(db, destinationId, { limit: 500 }).filter(
      (location) => location.status === "stored"
    ).length;

    deleteBackupDestination(db, destinationId);
    deleteBackupCredential(db, destinationId);

    return NextResponse.json({ deleted: true, orphanedCopies });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
