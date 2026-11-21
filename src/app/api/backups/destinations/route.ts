import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { createBackupDestination, listBackupDestinations, updateBackupDestination } from "@/lib/app-db/backupRepository";
import { upsertBackupCredential } from "@/lib/credentials/backupSecrets";
import { requireReadyVault } from "@/lib/credentials/vaultState";

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
    }

    const db = getAppDb();
    // Bench will not store an access key it cannot encrypt.
    if (payload.kind === "s3") requireReadyVault(db);
    // One transaction: a destination row whose keys failed to store would be
    // a destination that looks configured and fails every night.
    const destination = db.transaction(() => {
      const created = createBackupDestination(db, payload);
      if (payload.kind === "s3" && credentials?.accessKeyId && credentials?.secretAccessKey) {
        upsertBackupCredential(db, {
          ref: created.id,
          kind: "s3",
          label: created.name,
          secret: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
          },
        });
        // The reference is the destination's own id: one destination, one
        // secret, and deleting the destination has an obvious thing to delete.
        return updateBackupDestination(db, created.id, { credentialRef: created.id }) ?? created;
      }
      return created;
    })();

    return NextResponse.json({ destination }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}
