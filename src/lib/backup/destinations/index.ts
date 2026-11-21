import { getBackupCredential } from "@/lib/credentials/backupSecrets";
import type { S3Credentials } from "@/lib/credentials/backupSecrets";
import type { BackupDestination } from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { LocalDestinationAdapter } from "./local";
import { S3DestinationAdapter } from "./s3";
import { DestinationError, type DestinationAdapter } from "./types";

export * from "./types";
export { DESTINATION_MARKER, inspectLocalPath, LocalDestinationAdapter } from "./local";
export { S3DestinationAdapter, readS3Config } from "./s3";

function isS3Credentials(value: unknown): value is S3Credentials {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as S3Credentials).accessKeyId === "string" &&
    typeof (value as S3Credentials).secretAccessKey === "string"
  );
}

/**
 * Build the adapter for a destination, resolving its credentials (server-only).
 *
 * Fails closed, in the same shape as the automation engine's credential
 * handling: a destination that says it needs keys and cannot produce them is an
 * error, never an unauthenticated attempt. The alternative — trying anyway —
 * turns a vault misconfiguration into a pile of 403s that look like a broken
 * bucket.
 */
export function createDestinationAdapter(
  db: SqliteDatabase,
  destination: BackupDestination,
  options: { signal?: AbortSignal } = {}
): DestinationAdapter {
  if (destination.kind === "local") return new LocalDestinationAdapter(destination, options);

  if (!destination.credentialRef) {
    throw new DestinationError(
      `Destination "${destination.name}" has no stored credentials. Re-enter its access key to use it.`
    );
  }

  let secret: unknown;
  try {
    secret = getBackupCredential(db, destination.credentialRef);
  } catch (error) {
    throw new DestinationError(
      `Could not unseal credentials for "${destination.name}". The vault key may have changed since they were saved; see App Health.`,
      { cause: error }
    );
  }

  if (!isS3Credentials(secret)) {
    throw new DestinationError(
      `Stored credentials for "${destination.name}" are missing or unusable. Re-enter its access key.`
    );
  }

  return new S3DestinationAdapter(destination, secret, options);
}

/**
 * The adapter, after checking it points at the place Bench has been using.
 *
 * Used by everything that writes, deletes or decides a copy is missing. A
 * folder whose volume has come unmounted is refused here, before a backup can
 * land in the empty directory left behind or a scrub can call every real copy
 * missing.
 */
export async function openDestination(
  db: SqliteDatabase,
  destination: BackupDestination,
  options: { signal?: AbortSignal } = {}
): Promise<DestinationAdapter> {
  const adapter = createDestinationAdapter(db, destination, options);
  if (adapter.confirmIdentity) {
    const sample = db
      .prepare(
        `SELECT object_key FROM backup_artifact_locations
          WHERE destination_id = ? AND status = 'stored'
          ORDER BY created_at DESC LIMIT 1`
      )
      .get<{ object_key: string }>(destination.id);
    // Copies are expected only where Bench believes one is stored now; a
    // destination whose copies are all recorded missing has nothing to test
    // the folder against.
    await adapter.confirmIdentity({
      expectCopies: sample !== undefined,
      sampleKey: sample?.object_key ?? null,
    });
  }
  return adapter;
}
