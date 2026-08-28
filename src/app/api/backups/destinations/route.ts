import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { createBackupDestination, listBackupDestinations, updateBackupDestination } from "@/lib/app-db/backupRepository";
import { upsertBackupCredential } from "@/lib/app-db/backupCredentialRepository";
import { vaultEnabled } from "@/lib/sync/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ destinations: listBackupDestinations(getAppDb()) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

/**
 * Create a destination, sealing its credentials in the same request.
 *
 * The secret never becomes part of the destination row: it goes to the sealed
 * store and the row keeps a reference. Refusing up front when the vault is off
 * is the honest failure — accepting the keys and dropping them would leave a
 * destination that looks configured and fails every night at 2am.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Destination payload must be an object" }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;
    const credentials = payload.credentials as
      | { accessKeyId?: string; secretAccessKey?: string; sessionToken?: string }
      | undefined;
    delete payload.credentials;

    if (payload.kind === "s3") {
      if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
        return NextResponse.json(
          { error: "An access key and secret are required for an S3-compatible destination." },
          { status: 400 }
        );
      }
      if (!vaultEnabled()) {
        return NextResponse.json(
          {
            error:
              "Set SYNC_VAULT_KEY on the server before adding a bucket. Bench will not store an access key it cannot encrypt.",
          },
          { status: 400 }
        );
      }
    }

    const db = getAppDb();
    const destination = createBackupDestination(db, payload);

    if (payload.kind === "s3" && credentials?.accessKeyId && credentials?.secretAccessKey) {
      upsertBackupCredential(db, {
        ref: destination.id,
        kind: "s3",
        label: destination.name,
        secret: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
        },
      });
      // The reference is the destination's own id: one destination, one secret,
      // and deleting the destination has an obvious thing to delete.
      updateBackupDestination(db, destination.id, { credentialRef: destination.id });
    }

    return NextResponse.json({ destination: { ...destination, credentialRef: destination.id } }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
