import { getBackupCredential } from "@/lib/app-db/backupCredentialRepository";
import type { S3Credentials } from "@/lib/app-db/backupCredentialRepository";
import type { BackupDestination } from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { LocalDestinationAdapter } from "./local";
import { S3DestinationAdapter } from "./s3";
import { DestinationError, type DestinationAdapter } from "./types";

export * from "./types";
export { inspectLocalPath, LocalDestinationAdapter } from "./local";
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
  destination: BackupDestination
): DestinationAdapter {
  if (destination.kind === "local") return new LocalDestinationAdapter(destination);

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
      `Could not unseal credentials for "${destination.name}". Check that SYNC_VAULT_KEY is set to the same value it was when they were saved.`,
      { cause: error }
    );
  }

  if (!isS3Credentials(secret)) {
    throw new DestinationError(
      `Stored credentials for "${destination.name}" are missing or unusable. Re-enter its access key.`
    );
  }

  return new S3DestinationAdapter(destination, secret);
}
