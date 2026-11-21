import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBackupCredential } from "@/lib/credentials/backupSecrets";
import {
  getBackupArtifact,
  getBackupDestination,
  listArtifactLocations,
  type BackupArtifact,
  type BackupArtifactLocation,
  type BackupDestination,
} from "@/lib/app-db/backupRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { createDestinationAdapter } from "./destinations";
import { decryptArchive } from "./encryption";
import { sha256 } from "./manifest";
import { entryKey, unzipBounded } from "./verify";

/**
 * Getting a stored copy's bytes back, ready to read (RD-077).
 *
 * Shared by "Look inside", search and compare, which all start the same way:
 * try every stored copy, healthiest destination first, take the first whose
 * bytes match the recorded checksum, and decrypt it with the copy's own
 * passphrase or one typed for this read. Server-only.
 */

export type ArtifactRead =
  | {
      status: "opened";
      artifact: BackupArtifact;
      /** The archive as it was exported: decrypted when the copy is encrypted. */
      plaintext: Uint8Array;
      objectKey: string;
      destinationName: string;
    }
  | {
      /** Every copy that could be read has bytes that differ from the checksum. */
      status: "damaged";
      artifact: BackupArtifact;
      objectKey: string;
      destinationName: string;
    }
  | {
      /** Encrypted, and Bench holds no passphrase for it. */
      status: "needs-passphrase";
      artifact: BackupArtifact;
      objectKey: string;
      destinationName: string;
    };

/**
 * The stored copies of an artifact Bench can reach, healthiest destination
 * first: one whose last outcome was a success before one that last failed.
 */
export function readableLocations(
  db: SqliteDatabase,
  artifactId: string
): { location: BackupArtifactLocation; destination: BackupDestination }[] {
  const healthy = (destination: BackupDestination) =>
    !destination.lastFailureAt || (destination.lastSuccessAt ?? "") > destination.lastFailureAt;
  return listArtifactLocations(db, artifactId)
    .filter((location) => location.status === "stored" && location.destinationId)
    .map((location) => ({ location, destination: getBackupDestination(db, location.destinationId as string) }))
    .filter(
      (entry): entry is { location: BackupArtifactLocation; destination: BackupDestination } =>
        entry.destination !== null
    )
    .sort((a, b) => Number(healthy(b.destination)) - Number(healthy(a.destination)));
}

export function storedPassphrase(db: SqliteDatabase, artifact: BackupArtifact): string | null {
  // The artifact's own reference only: a rule's current passphrase cannot
  // open a copy taken before it changed.
  const ref = artifact.encryptionCredentialRef;
  if (!ref) return null;
  try {
    const secret = getBackupCredential(db, ref);
    return secret && "passphrase" in secret ? secret.passphrase : null;
  } catch {
    return null;
  }
}

/**
 * Read a stored copy back. Throws when the backup is unknown or no copy could
 * be fetched at all; a damaged copy or a missing passphrase is a status.
 */
export async function readArtifact(
  db: SqliteDatabase,
  artifactId: string,
  options: { passphrase?: string; signal?: AbortSignal } = {}
): Promise<ArtifactRead> {
  const artifact = getBackupArtifact(db, artifactId);
  if (!artifact) throw new Error("That backup is not in the inventory.");

  // Every stored copy, healthiest destination first, until one can be read:
  // trying only the first left a second, intact copy unused whenever the
  // first destination was down.
  const candidates = readableLocations(db, artifactId);
  if (candidates.length === 0) {
    throw new Error("Bench has no stored copy of this backup to open.");
  }

  // The first copy whose bytes match the checksum wins. A damaged copy is
  // passed over for the next one, and reported as damaged only when every
  // copy that could be read is.
  let damaged: (typeof candidates)[number] | null = null;
  const errors: string[] = [];
  for (const candidate of candidates) {
    let bytes: Buffer;
    try {
      bytes = await createDestinationAdapter(db, candidate.destination, { signal: options.signal }).get(
        candidate.location.objectKey
      );
    } catch (error) {
      options.signal?.throwIfAborted();
      errors.push(`${candidate.destination.name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (sha256(bytes) !== artifact.checksumSha256) {
      damaged ??= candidate;
      continue;
    }

    const where = { artifact, objectKey: candidate.location.objectKey, destinationName: candidate.destination.name };
    if (!artifact.encrypted) return { status: "opened", plaintext: bytes, ...where };
    const passphrase = options.passphrase ?? storedPassphrase(db, artifact);
    if (!passphrase) return { status: "needs-passphrase", ...where };
    return { status: "opened", plaintext: decryptArchive(bytes, passphrase), ...where };
  }

  if (damaged) {
    return {
      status: "damaged",
      artifact,
      objectKey: damaged.location.objectKey,
      destinationName: damaged.destination.name,
    };
  }
  throw new Error(`No copy of this backup could be read. ${errors.join("; ")}`);
}

export type BudgetDatabase = InstanceType<typeof Database>;

/**
 * Open a budget export's `db.sqlite` read-only for the length of `work`.
 *
 * better-sqlite3 needs a file, so the database is written to a private temp
 * folder that is removed afterwards, whatever `work` does. Nothing is ever
 * written to the copy.
 */
export function withBudgetDatabase<T>(plaintext: Uint8Array, work: (database: BudgetDatabase) => T): T {
  const files = unzipBounded(plaintext);
  // Found the way verification finds it, so a copy that verified also opens.
  const entry = Object.entries(files).find(([name]) => entryKey(name) === "db.sqlite");
  if (!entry) throw new Error("The archive does not contain db.sqlite, so it is not an Actual export.");

  const scratch = mkdtempSync(join(tmpdir(), "bench-read-"));
  let database: BudgetDatabase | null = null;
  try {
    const path = join(scratch, "db.sqlite");
    writeFileSync(path, entry[1]);
    database = new Database(path, { readonly: true, fileMustExist: true });
    return work(database);
  } finally {
    database?.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The message for a read that did not open, for the page to show as is. */
export function unopenedMessage(read: Exclude<ArtifactRead, { status: "opened" }>): string {
  return read.status === "damaged"
    ? "The stored bytes no longer match the checksum recorded when this backup was written. Treat it as damaged."
    : "This backup is encrypted and Bench has no stored passphrase for it. Enter the passphrase to open it.";
}
